/*
 * 本地数据文件的多进程合并
 * 作者: JularDepick
 *
 * 合并模型:以磁盘内容为基底, 叠加本进程相对"上次落盘基线"的增量.
 * - 累计量: 磁盘值 + max(0, 内存值 - 基线值), 两侧增量都不丢;
 * - 队列/失败/记录: 按标识合并, 只并入本进程新增(基线里没有)的条目, 已落盘条目由磁盘版本胜出;
 * - 云端快照: 取 syncedAt 较新者, 但本进程主动清空(基线有值而内存为空)时以清空为准,
 *   否则换账号后的作废动作会被磁盘上的旧快照复活;
 * - 更新时间: 取最大值.
 */

import { FAILED_TASK_LIMIT, PENDING_QUEUE_LIMIT, REPORT_LOG_LIMIT, STORE_FILE_VERSION } from '../constants'
import type { PendingHeartbeatEntry } from '../heartbeat'
import type { StatsTotals } from '../stats'
import { heartbeatKeyOf } from './normalize'
import type { StoreFile } from './types'

/* 累计量字段键(与 StatsTotals 一致) */
const TOTAL_KEYS = [
  'heartbeats', 'toolCalls', 'userMessages', 'inputTokens', 'outputTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'promptChars',
  'promptTokens', 'thinkingMs',
] as const satisfies readonly (keyof StatsTotals)[]

/* 按标识合并列表: 磁盘条目在前, 仅追加本进程新增的条目, 超出上限时保留尾部 */
function mergeList<T>(disk: readonly T[], memory: readonly T[], baseline: readonly T[], keyOf: (item: T) => string, limit?: number): T[] {
  const baseKeys = new Set(baseline.map(keyOf))
  const seen = new Set(disk.map(keyOf))
  const result = [...disk]
  for (const item of memory) {
    const key = keyOf(item)
    if (seen.has(key) || baseKeys.has(key)) continue
    result.push(item)
    seen.add(key)
  }
  return limit === undefined ? result : result.slice(-limit)
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
export function mergeStore(disk: StoreFile, memory: StoreFile, baseline: StoreFile): StoreFile {
  return {
    version: STORE_FILE_VERSION,
    updatedAt: Math.max(disk.updatedAt, memory.updatedAt),
    stats: mergeStats(disk.stats, memory.stats, baseline.stats),
    cloud: mergeCloud(disk.cloud, memory.cloud, baseline.cloud),
    pending: {
      queue: mergeList(disk.pending.queue, memory.pending.queue, baseline.pending.queue, heartbeatKeyOf, PENDING_QUEUE_LIMIT),
      failed: mergeList(disk.pending.failed, memory.pending.failed, baseline.pending.failed, (item) => item.id, FAILED_TASK_LIMIT),
      report: mergeList(disk.pending.report, memory.pending.report, baseline.pending.report, (item) => item.id, REPORT_LOG_LIMIT),
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
