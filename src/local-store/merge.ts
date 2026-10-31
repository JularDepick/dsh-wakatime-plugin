/*
 * 本地数据文件的多进程合并
 * 作者: JularDepick
 *
 * 合并模型:以磁盘内容为基底, 叠加本进程相对"上次落盘基线"的增量.
 * - 累计量: 磁盘值 + max(0, 内存值 - 基线值), 两侧增量都不丢;
 * - 队列/失败/记录: 按标识合并, 本进程新增的追加, 本进程删除的(基线有而内存没有)移除,
 *   同键条目以内存侧为准(尝试次数与记录状态只在本进程内存里推进);
 * - 云端快照: 取 syncedAt 较新者, 但本进程主动清空(基线有值而内存为空)时以清空为准,
 *   否则换账号后的作废动作会被磁盘上的旧快照复活;
 * - 更新时间: 取最大值.
 */

import { FAILED_TASK_LIMIT, PENDING_QUEUE_LIMIT, REPORT_LOG_LIMIT, STORE_FILE_VERSION } from '../constants'
import { compressPendingQueue } from '../heartbeat/compress'
import type { PendingHeartbeatEntry } from '../heartbeat'
import type { StatsTotals } from '../stats'
import { heartbeatKeyOf } from '../heartbeat/identity'
import type { StoreFile } from './types'

/* 累计量字段键(与 StatsTotals 一致) */
const TOTAL_KEYS = [
  'heartbeats', 'toolCalls', 'userMessages', 'inputTokens', 'outputTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'promptChars',
  'promptTokens', 'thinkingMs',
] as const satisfies readonly (keyof StatsTotals)[]

/* 列表合并选项: 上限、超限时的压缩手段、被丢弃条数的通知 */
interface MergeListOptions<T> {
  limit?: number
  compress?: (items: readonly T[]) => T[]
  onDrop?: (count: number) => void
}

/* 按标识合并列表: 以磁盘为基底, 叠加本进程相对基线的改动(新增 / 删除 / 同键更新);
   删除由"基线里有、内存里已没有"表达 —— 推送成功出队与手动重试移出失败列表都走这条,
   缺了它已上报的心跳会在落盘时被磁盘版本复活, 重启后重复上报;
   同键条目以内存侧为准(尝试次数递增、上报记录由失败翻成已重试都只发生在内存);
   超出上限时若提供压缩手段则先压缩(待发送队列靠它保留最旧的未上报心跳),
   否则才截断尾部, 并把丢弃条数通知出去 */
function mergeList<T>(
  disk: readonly T[],
  memory: readonly T[],
  baseline: readonly T[],
  keyOf: (item: T) => string,
  options: MergeListOptions<T> = {},
): T[] {
  const { limit, compress, onDrop } = options
  const liveByKey = new Map(memory.map((item) => [keyOf(item), item]))
  const baseKeys = new Set(baseline.map(keyOf))
  const removed = new Set([...baseKeys].filter((key) => !liveByKey.has(key)))
  const known = new Set<string>()
  let result: T[] = []
  for (const item of disk) {
    const key = keyOf(item)
    if (removed.has(key)) continue
    result.push(liveByKey.get(key) ?? item)
    known.add(key)
  }
  for (const item of memory) {
    const key = keyOf(item)
    if (known.has(key) || baseKeys.has(key)) continue
    result.push(item)
    known.add(key)
  }
  if (limit === undefined || result.length <= limit) return result
  /* 有压缩手段时先压缩: 压缩把相邻两条并成一条, 不丢最旧的待发心跳 */
  if (compress !== undefined) result = compress(result)
  if (result.length <= limit) return result
  onDrop?.(result.length - limit)
  return result.slice(-limit)
}

/* 累计量合并: 磁盘值 + 本进程增量(基线为空时按 0 处理) */
function mergeStats(disk: StatsTotals | undefined, memory: StatsTotals | undefined, baseline: StatsTotals | undefined): StatsTotals {
  const totals = {} as StatsTotals
  for (const key of TOTAL_KEYS) {
    const diskValue = disk?.[key] ?? 0
    const delta = (memory?.[key] ?? 0) - (baseline?.[key] ?? 0)
    totals[key] = Math.max(0, diskValue + Math.max(0, delta))
  }
  return totals
}

/* 云端快照: 取同步时刻较新者; 本进程主动清空(基线仍有值而内存已空)时以清空为准,
   否则换账号后作废动作会在落盘合并里被磁盘旧快照复活 */
function mergeCloud(
  disk: StoreFile['cloud'],
  memory: StoreFile['cloud'],
  baseline: StoreFile['cloud'],
): StoreFile['cloud'] {
  if (!memory) {
    if (baseline) return null
    return disk
  }
  if (!disk) return memory
  return memory.syncedAt >= disk.syncedAt ? memory : disk
}

/* 合并整个数据文件: disk 为磁盘现值, memory 为本进程内存, baseline 为本进程上次落盘的内容 */
export function mergeStore(disk: StoreFile, memory: StoreFile, baseline: StoreFile, onDrop?: (scope: string, count: number) => void): StoreFile {
  /* 待发送队列超限时先压缩(相邻两条合并, 保留最旧的未上报心跳),
     压缩后仍超限才截断, 并告知丢弃条数; 失败列表与上报记录超限时只保留最近若干条 */
  const queueDrop = (count: number) => onDrop?.('queue', count)
  const failedDrop = (count: number) => onDrop?.('failed', count)
  const reportDrop = (count: number) => onDrop?.('report', count)
  return {
    version: STORE_FILE_VERSION,
    updatedAt: Math.max(disk.updatedAt, memory.updatedAt),
    stats: mergeStats(disk.stats, memory.stats, baseline.stats),
    cloud: mergeCloud(disk.cloud, memory.cloud, baseline.cloud),
    pending: {
      queue: mergeList(disk.pending.queue, memory.pending.queue, baseline.pending.queue, heartbeatKeyOf, {
        limit: PENDING_QUEUE_LIMIT,
        compress: (items) => compressPendingQueue(items, PENDING_QUEUE_LIMIT).queue,
        onDrop: queueDrop,
      }),
      failed: mergeList(disk.pending.failed, memory.pending.failed, baseline.pending.failed, (item) => item.id, {
        limit: FAILED_TASK_LIMIT,
        onDrop: failedDrop,
      }),
      report: mergeList(disk.pending.report, memory.pending.report, baseline.pending.report, (item) => item.id, {
        limit: REPORT_LOG_LIMIT,
        onDrop: reportDrop,
      }),
    },
  }
}

/* 自检: 合并结果不得让累计量变小(防合并逻辑错误写坏数据) */
export function isMergeSane(disk: StoreFile, merged: StoreFile): boolean {
  for (const metric of TOTAL_KEYS) {
    if (merged.stats[metric] < disk.stats[metric]) return false
  }
  return true
}

export type { PendingHeartbeatEntry }
