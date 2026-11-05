/*
 * 两槽同账号判定(一次性写入取证)
 * 作者: JularDepick
 *
 * 背景: 写入槽用 API Key, 官方该接口的 202 响应体只有 id/entity/type/time, 不带任何用户标识,
 * 读取面(心跳列表)也不带 user 字段, 因此无法直接比较两槽的账号标识.
 * 做法是一次净零往返:
 * 1. 用写入槽写一条带唯一 entity 的探测心跳(取证对象);
 * 2. 用读取槽回读当日心跳, 能读到这条即两槽属于同一账号;
 * 3. 无论判定结果如何都用写入槽把这条心跳删掉, 不留可见数据.
 * 净残留只有账号上的 last_heartbeat_at 与插件统计元数据, 报表看不到数据点.
 * 判定不确定(写失败, 回读被拒, 网络异常)时一律返回 unknown 而不是 different,
 * 避免把网络波动当成"两个账号", 让用户无法保存凭证.
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

/* 写入响应与列表响应的最小面(只关心 id 与 entity) */
interface HeartbeatRecord { id?: string, entity?: string }
interface HeartbeatWriteResponse { data?: HeartbeatRecord | null }
interface HeartbeatListResponse { data?: Array<HeartbeatRecord | null> | null }

/* 日志出口(清理失败等异常在此留痕) */
export interface ProbeLogger {
  warn?: (message: string) => void
}

/* 本地日期(yyyy-MM-dd): 回读与删除的 date 参数按自然日划分 */
function localDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
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

/* 删除探测心跳: 失败只记告警, 不影响判定结果 */
async function deleteProbe(http: HttpClient, header: AuthHeader, date: string, id: string, logger?: ProbeLogger): Promise<void> {
  try {
    await http.request(HEARTBEATS_BULK_PATH, {
      method: 'DELETE',
      body: { date, ids: [id] },
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
  const date = localDate(now)
  /* 探测心跳只用于取证: 不重试, 避免写下多条只删得掉一条 */
  let createdId = ''
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
    /* 没有 id 就删不掉, 也就无从回读: 按无法确认处理 */
    if (createdId === '') return 'unknown'
    for (let attempt = 0; attempt <= SAME_ACCOUNT_READ_RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(SAME_ACCOUNT_READ_BACKOFF_MS)
      /* 回读同样不重试: 判定失败由循环自己掌控节奏, 不叠加 HTTP 层退避 */
      const list = await http.request<HeartbeatListResponse>(`${HEARTBEATS_PATH}?date=${date}`, {
        method: 'GET',
        auth: readHeader,
        noRetry: true,
      })
      const items = Array.isArray(list?.data) ? list.data : []
      const hit = items.some((item) => item !== null && typeof item === 'object'
        && ((item.id ?? '') === createdId || (item.entity ?? '') === marker))
      if (hit) return 'same'
    }
    /* 读取面可用却没有这条: 两侧不是同一个账号 */
    return 'different'
  } catch (error) {
    logger?.warn?.('[wakatime] same-account probe failed: ' + String(error))
    return 'unknown'
  } finally {
    if (createdId !== '') await deleteProbe(http, writeHeader, date, createdId, logger)
  }
}
