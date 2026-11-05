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
 * 判定不确定(写失败, 回读被拒, 响应形状异常, 网络异常)时一律返回 unknown 而不是 different,
 * 避免把网络波动或时区差异当成"两个账号", 让用户无法保存凭证.
 *
 * 日期口径: 官方心跳列表与删除接口的 date 参数按账号时区的自然日划分
 * (文档原文 "12am until 11:59pm in user's timezone"), 而账号时区可能是 UTC 或与本机不同.
 * 因此日期必须在写入之后取, 并且回读时依次尝试本机日与前后各一天(时区偏移最多 ±1 天),
 * 删除按实际命中那一天执行 —— 否则本地 00:00 至 08:00 写入的探测心跳会被归到前一天,
 * 回读永远命中不到, 既误判成"两个账号", 又把探测心跳留在用户报表里.
 *
 * 顺手清理: 回读时把同前缀的历史探测心跳(上次进程被杀或删除失败留下的)一并收集并按各自日期删除,
 * 这样残留会随下一次取证自愈, 不依赖那次调用是否成功.
 */

import {
  HEARTBEATS_BULK_PATH,
  HEARTBEATS_PATH,
  SAME_ACCOUNT_PROBE_ENTITY_PREFIX,
  SAME_ACCOUNT_READ_BACKOFF_MS,
  SAME_ACCOUNT_READ_RETRIES,
} from '../constants'
import type { AuthHeader, HttpClient } from '../http'
import type { SameAccountVerdict } from './types'

/* 一天毫秒数(用于生成前后各一天的候选日期) */
const DAY_MS = 24 * 60 * 60 * 1000

/* 写入响应与列表响应的最小面(只关心 id 与 entity) */
interface HeartbeatRecord { id?: string, entity?: string }
interface HeartbeatWriteResponse { data?: HeartbeatRecord | null }
interface HeartbeatListResponse { data?: Array<HeartbeatRecord | null> | null }

/* 日志出口(清理失败等异常在此留痕) */
export interface ProbeLogger {
  warn?: (message: string) => void
}

/* 本地日期(yyyy-MM-dd): 候选日期按本机日历日生成, 时区差异由候选集合覆盖 */
function localDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/* 候选日期: 本机日, 前一天, 后一天(去重) */
function candidateDates(timestamp: number): string[] {
  const dates = [localDate(timestamp), localDate(timestamp - DAY_MS), localDate(timestamp + DAY_MS)]
  return [...new Set(dates)]
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

/* 是否为本插件的探测心跳(用于顺手清理历史残留) */
function isProbeEntity(entity: string | undefined): boolean {
  return typeof entity === 'string' && entity.startsWith(SAME_ACCOUNT_PROBE_ENTITY_PREFIX)
}

/* 按日期删除若干条探测心跳: 失败只记告警, 不影响判定结果 */
async function deleteProbes(
  http: HttpClient,
  header: AuthHeader,
  date: string,
  ids: readonly string[],
  logger?: ProbeLogger,
): Promise<void> {
  if (ids.length === 0) return
  try {
    await http.request(HEARTBEATS_BULK_PATH, {
      method: 'DELETE',
      body: { date, ids: [...ids] },
      auth: header,
      noRetry: true,
    })
  } catch (error) {
    logger?.warn?.('[wakatime] failed to delete same-account probe heartbeat: ' + String(error))
  }
}

/*
 * 判定两槽是否同一账号.
 * @param http - HTTP 客户端.
 * @param writeHeader - 写入槽认证头(API Key).
 * @param readHeader - 读取槽认证头(OAuth 令牌).
 * @param logger - 告警出口(可选).
 * @returns same 同一账号 / different 不同账号 / unknown 无法确认.
 */
export async function probeSameAccount(
  http: HttpClient,
  writeHeader: AuthHeader,
  readHeader: AuthHeader,
  logger?: ProbeLogger,
): Promise<SameAccountVerdict> {
  const marker = probeMarker()
  const now = Date.now()
  /* 写入时间戳用 UTC 秒; 日期一律在写入之后再取, 避免跨零点时日期先于数据落库 */
  let createdId = ''
  /* 待删除: 日期 -> 心跳 id 集合(含本次探测与顺手清理的历史残留) */
  const pending = new Map<string, Set<string>>()
  const remember = (date: string, id: string): void => {
    const bucket = pending.get(date) ?? new Set<string>()
    bucket.add(id)
    pending.set(date, bucket)
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
    })
    createdId = typeof created?.data?.id === 'string' ? created.data.id : ''
    /* 没有 id 就删不掉: 按无法确认处理(响应形状异常, 不是账号不同) */
    if (createdId === '') return 'unknown'
    const dates = candidateDates(now)
    const primaryDate = localDate(Date.now())
    for (let attempt = 0; attempt <= SAME_ACCOUNT_READ_RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(SAME_ACCOUNT_READ_BACKOFF_MS)
      /* 先查写入时刻的当日, 没命中再扫前后一天(覆盖账号时区与本机时区不同的情况) */
      const ordered = [primaryDate, ...dates.filter((date) => date !== primaryDate)]
      for (const date of ordered) {
        const list = await http.request<HeartbeatListResponse>(`${HEARTBEATS_PATH}?date=${date}`, {
          method: 'GET',
          auth: readHeader,
          noRetry: true,
        })
        /* 响应不是数组(网关包装页, 分页包装, data 为 null)无法据此判定账号: 按未知处理 */
        if (!Array.isArray(list?.data)) return 'unknown'
        let hit = false
        for (const item of list.data) {
          if (item === null || typeof item !== 'object') continue
          const id = typeof item.id === 'string' ? item.id : ''
          if (id === createdId || item.entity === marker) {
            hit = true
            /* 命中即用列表里的 id(与写入时返回的 id 一致才是常态, 不一致时按服务端的记录删) */
            remember(date, id === '' ? createdId : id)
            continue
          }
          /* 顺手收集历史残留: 同前缀但不是本次探测心跳 */
          if (id !== '' && isProbeEntity(item.entity)) remember(date, id)
        }
        if (hit) return 'same'
      }
    }
    /* 读取面可用(数组形状正常)却找不到这条: 两侧不是同一个账号 */
    return 'different'
  } catch (error) {
    logger?.warn?.('[wakatime] same-account probe failed: ' + String(error))
    return 'unknown'
  } finally {
    /* 本次探测兜底删除: 即使判定失败或中途异常也要删掉, 避免残留.
       回读可能在任何一天命中(账号时区与本机可能差一天), 故未命中记录时按三个候选日期都试一次 */
    if (createdId !== '') {
      const known = [...pending.entries()].some(([, ids]) => ids.has(createdId))
      if (!known) {
        for (const date of candidateDates(Date.now())) remember(date, createdId)
      }
    }
    for (const [date, ids] of pending) {
      await deleteProbes(http, writeHeader, date, [...ids], logger)
    }
  }
}
