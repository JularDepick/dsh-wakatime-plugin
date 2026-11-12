/*
 * 两槽同账号判定(一次性写入取证)
 * 作者: JularDepick
 *
 * 背景: 写入槽用 API Key, 官方该接口的 202 响应体只有 id/entity/type/time, 不带任何用户标识,
 * 读取面(心跳列表)也不带 user 字段, 因此无法直接比较两槽的账号标识.
 * 做法是一次净零往返:
 * 1. 用写入槽写一条带唯一 entity 的探测心跳(取证对象);
 * 2. 用读取槽回读当日心跳, 能读到这条即两槽属于同一账号;
 * 3. 无论判定结果如何都用写入槽把它删掉, 不留可见数据.
 * 净残留只有账号上的 last_heartbeat_at 与插件统计元数据, 报表看不到数据点.
 *
 * 判定口径(从严): 只有"读取面可用 + 拿到非空且未达截断阈值的当日列表 + 列表里没有本次探测心跳"
 * 才判 different; 空列表, 列表达到截断阈值, 响应形状异常, 超预算, 网络异常一律 unknown.
 * 理由: unknown 只是"未确认"(照常保存并在界面提示), different 会直接拒绝保存并挡住用户,
 * 误判成本高得多 —— 保存失败时用户只会反复重试, 每次都再写一条探测心跳.
 *
 * 日期口径: 官方心跳列表与删除接口的 date 参数按账号时区的自然日划分
 * (文档原文 "12am until 11:59pm in user's timezone"), 而账号时区可能是 UTC 或与本机不同,
 * 全球时区偏移跨度是 -12:00 至 +14:00(最多相差 26 小时), 故候选日期取本机日前后各两天并去重.
 * 日期一律在写入之后取, 删除按实际命中那一天执行 —— 否则本地 00:00 至 08:00 写入的探测心跳
 * 会被归到前一天, 回读永远命中不到, 既误判又把探测心跳留在用户报表里.
 *
 * 顺手清理: 回读时把同前缀的历史探测心跳(上次进程被杀或删除失败留下的)一并收集并按各自日期删除,
 * 判据是完整形态加 type/is_write 佐证, 避免误删用户自己的同名实体.
 */

import {
  HEARTBEATS_BULK_PATH,
  HEARTBEATS_PATH,
  SAME_ACCOUNT_CLEANUP_BUDGET_MS,
  SAME_ACCOUNT_CONFIRM_DELAY_MS,
  SAME_ACCOUNT_LIST_TRUNCATE_HINT,
  SAME_ACCOUNT_DATE_OFFSETS,
  SAME_ACCOUNT_PROBE_ENTITY_PREFIX,
  SAME_ACCOUNT_READ_BACKOFF_MS,
  SAME_ACCOUNT_READ_RETRIES,
  SAME_ACCOUNT_TOTAL_BUDGET_MS,
} from '../constants'
import type { AuthHeader, HttpClient } from '../http'
import type { SameAccountVerdict } from './types'

/* 写入响应与列表响应的最小面(只关心 id, entity 与探测心跳的形态字段) */
interface HeartbeatRecord { id?: string, entity?: string, type?: string, is_write?: boolean }
interface HeartbeatWriteResponse { data?: HeartbeatRecord | null }
interface HeartbeatListResponse { data?: Array<HeartbeatRecord | null> | null }

/* 日志出口(清理失败等异常在此留痕) */
export interface ProbeLogger {
  warn?: (message: string) => void
}

/* 本地日期(yyyy-MM-dd) */
function localDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/* 按日历日偏移取日期字符串(加减天数用 setDate, 避免夏令时切换日出现 ±1 小时的错位) */
function shiftedDate(timestamp: number, offsetDays: number): string {
  const date = new Date(timestamp)
  date.setDate(date.getDate() + offsetDays)
  return localDate(date.getTime())
}

/* 候选日期: 本机日, 前后各一天, 前后各两天(按与本地日的接近程度排序, 去重);
   跨度与顺序同 SAME_ACCOUNT_DATE_OFFSETS */
function candidateDates(timestamp: number): string[] {
  return [...new Set(SAME_ACCOUNT_DATE_OFFSETS.map((offset) => shiftedDate(timestamp, offset)))]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* 探测标记: 前缀 + 时间戳 + 随机串, 保证同一天多次取证互不干扰 */
function probeMarker(): string {
  const stamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `${SAME_ACCOUNT_PROBE_ENTITY_PREFIX}-${stamp}-${random}`
}

/* 是否为本插件的历史探测心跳: 完整形态 + app 类型 + 非写入,
   只按前缀判断会把用户自己恰好同前缀的实体一起删掉 */
function isStaleProbe(item: HeartbeatRecord): boolean {
  if (typeof item.entity !== 'string') return false
  const shape = new RegExp('^' + SAME_ACCOUNT_PROBE_ENTITY_PREFIX + '-[a-z0-9]+-[a-z0-9]+$')
  if (!shape.test(item.entity)) return false
  if (item.type !== undefined && item.type !== 'app') return false
  if (item.is_write === true) return false
  return true
}

/* 按日期删除若干条探测心跳: 失败只记告警, 不影响判定结果 */
async function deleteProbes(
  http: HttpClient,
  header: AuthHeader,
  date: string,
  ids: readonly string[],
  signal: AbortSignal,
  logger?: ProbeLogger,
): Promise<void> {
  if (ids.length === 0) return
  try {
    await http.request(HEARTBEATS_BULK_PATH, {
      method: 'DELETE',
      body: { date, ids: [...ids] },
      auth: header,
      noRetry: true,
      signal,
    })
  } catch (error) {
    logger?.warn?.('[wakatime] failed to delete same-account probe heartbeat: ' + String(error))
  }
}

/* 单次回读结果: ok 表示形状正常(含命中与否与条数), unknown 表示无法据此判定 */
type ReadResult = { kind: 'ok', hit: boolean, size: number } | { kind: 'unknown' }

/*
 * 判定两槽是否同一账号.
 * @param http - HTTP 客户端.
 * @param writeHeader - 写入槽认证头(API Key).
 * @param readHeader - 读取槽认证头(OAuth 令牌).
 * @param logger - 告警出口(可选).
 * @param budgetMs - 整段取证的总预算(毫秒); 缺省取 SAME_ACCOUNT_TOTAL_BUDGET_MS,
 *     仅回归脚本用小值覆盖, 生产路径不传.
 * @returns same 同一账号 / different 不同账号 / unknown 无法确认.
 */
export async function probeSameAccount(
  http: HttpClient,
  writeHeader: AuthHeader,
  readHeader: AuthHeader,
  logger?: ProbeLogger,
  budgetMs: number = SAME_ACCOUNT_TOTAL_BUDGET_MS,
): Promise<SameAccountVerdict> {
  const marker = probeMarker()
  const now = Date.now()
  /* 整段取证的硬预算: 慢响应时不让一次保存请求挂到数分钟 */
  const budget = new AbortController()
  const budgetTimer = setTimeout(() => { budget.abort() }, budgetMs)
  budgetTimer.unref?.()
  let createdId = ''
  /* 待删除: 日期 -> 心跳 id 集合(含本次探测与顺手清理的历史残留) */
  const pending = new Map<string, Set<string>>()
  const remember = (date: string, id: string): void => {
    const bucket = pending.get(date) ?? new Set<string>()
    bucket.add(id)
    pending.set(date, bucket)
  }
  /* 最近一次"非空且未命中"的列表条数(用于最终判定) */
  let lastMissSize = 0
  /* 扫一遍候选日期: 即使已经命中也要扫完其余日期, 把跨天残留一并收集;
     已经命中后, 其余日期的读失败/形状异常只影响清理, 不再把结论降级成 unknown */
  const sweep = async (dates: readonly string[]): Promise<ReadResult> => {
    let hit = false
    for (const date of dates) {
      let list: HeartbeatListResponse
      try {
        list = await http.request<HeartbeatListResponse>(`${HEARTBEATS_PATH}?date=${date}`, {
          method: 'GET',
          auth: readHeader,
          noRetry: true,
          signal: budget.signal,
        })
      } catch (error) {
        if (hit) {
          logger?.warn?.('[wakatime] failed to sweep probe residue: ' + String(error))
          continue
        }
        throw error
      }
      /* 响应不是数组(网关包装页, 分页包装, data 为 null)无法据此判定账号 */
      if (!Array.isArray(list?.data)) {
        if (hit) continue
        return { kind: 'unknown' }
      }
      for (const item of list.data) {
        if (item === null || typeof item !== 'object') continue
        const id = typeof item.id === 'string' ? item.id : ''
        if (item.entity === marker || (id !== '' && id === createdId)) {
          hit = true
          /* 命中即用列表里的 id(与写入时返回的 id 一致才是常态, 不一致时按服务端的记录删) */
          remember(date, id === '' ? createdId : id)
          continue
        }
        /* 顺手收集历史残留: 同前缀形态但不是本次探测心跳 */
        if (id !== '' && isStaleProbe(item)) remember(date, id)
      }
      /* 空列表说明"读取面看不到当天任何心跳", 不足以证明不是同一账号(账号当天可能本来就没活动,
         也可能日期落在别的时区日) —— 只有非空列表才具备判定力 */
      if (list.data.length === 0) continue
      /* 列表达到截断阈值: 服务端可能分页/截断, 未命中不等于不存在 */
      if (list.data.length >= SAME_ACCOUNT_LIST_TRUNCATE_HINT) {
        if (hit) continue
        return { kind: 'unknown' }
      }
      /* 非空且未命中: 记下来, 继续扫其它候选日期 */
      lastMissSize = list.data.length
    }
    return { kind: 'ok', hit, size: lastMissSize }
  }
  try {
    const created = await http.request<HeartbeatWriteResponse>(HEARTBEATS_PATH, {
      method: 'POST',
      body: {
        entity: marker,
        type: 'app',
        category: 'debugging',
        time: Math.floor(now / 1000),
        is_write: false,
      },
      auth: writeHeader,
      noRetry: true,
      signal: budget.signal,
    })
    createdId = typeof created?.data?.id === 'string' ? created.data.id : ''
    if (createdId === '') {
      /* 写入响应形状异常: 没有 id 无法直接删除, 但回读一次仍可能按 entity 把那条
          探测心跳找出来, 让 finally 能删掉它; 结论只能是未知(形状异常不是账号不同) */
      logger?.warn?.('[wakatime] probe heartbeat write returned no id, verdict unknown')
      try {
        await sweep(candidateDates(Date.now()))
      } catch {
        /* 回读失败: 没有 id 也无从删除, 只能等下次取证按 entity 自愈 */
      }
      return 'unknown'
    }
    /* 日期在写入之后取: 跨零点时数据可能落在第二天 */
    const dates = candidateDates(Date.now())
    for (let attempt = 0; attempt <= SAME_ACCOUNT_READ_RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(SAME_ACCOUNT_READ_BACKOFF_MS)
      const result = await sweep(dates)
      if (result.kind === 'unknown') return 'unknown'
      if (result.hit) return 'same'
    }
    /* 落空后再等最后一次: 服务端入库滞后到最后一轮才可见时, 不至于误判成两个账号 */
    if (!budget.signal.aborted) {
      await sleep(SAME_ACCOUNT_CONFIRM_DELAY_MS)
      if (!budget.signal.aborted) {
        const confirm = await sweep(dates)
        if (confirm.kind === 'unknown') return 'unknown'
        if (confirm.hit) return 'same'
      }
    }
    /* 只有"确实拿到过非空列表且始终没有这条"才判不同账号;
       但整段预算已经耗尽(含确认等待期间超时)时必须按未知处理:
       超预算时结论只代表"没等到确认", 不代表两槽不同账号, 否则合法同账号双槽会被误挡 */
    if (budget.signal.aborted) return 'unknown'
    return lastMissSize > 0 ? 'different' : 'unknown'
  } catch (error) {
    logger?.warn?.('[wakatime] same-account probe failed: ' + String(error))
    return 'unknown'
  } finally {
    clearTimeout(budgetTimer)
    /* 本次探测兜底删除: 即使判定失败或中途异常也要删掉, 避免残留.
       回读可能在任何一天命中(账号时区与本机可能差两天), 故未命中记录时按全部候选日期都试一次 */
    if (createdId !== '') {
      const known = [...pending.entries()].some(([, ids]) => ids.has(createdId))
      if (!known) {
        for (const date of candidateDates(Date.now())) remember(date, createdId)
      }
    }
    /* 清理不受取证总预算影响(预算用尽时也要把残留删掉), 但另设独立上限:
       单次 DELETE 受 REQUEST_TIMEOUT_MS 约束, 最多 5 个候选日期串起来仍可能挂到两分钟以上 */
    const cleanup = new AbortController()
    const cleanupTimer = setTimeout(() => { cleanup.abort() }, SAME_ACCOUNT_CLEANUP_BUDGET_MS)
    cleanupTimer.unref?.()
    try {
      for (const [date, ids] of pending) {
        await deleteProbes(http, writeHeader, date, [...ids], cleanup.signal, logger)
      }
    } finally {
      clearTimeout(cleanupTimer)
    }
  }
}
