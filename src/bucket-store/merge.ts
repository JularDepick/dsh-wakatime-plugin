/*
 * 数据桶文件的多进程合并
 * 作者: JularDepick
 *
 * 合并模型:以磁盘内容为基底, 叠加本进程相对"上次落盘基线"的增量.
 * - 累计量(战绩数值): 磁盘值 + max(0, 内存值 - 基线值), 两侧增量都不丢;
 * - 队列/失败/记录: 按 id 合并, 只并入本进程新增(基线里没有)的条目, 已落盘条目由磁盘版本胜出;
 * - 云端快照: 取 syncedAt 较新者;
 * - 模糊凭证: 非空优先(内存覆盖磁盘);
 * - 更新时间: 取最大值;
 * - 删除墓碑: 取两侧较新值, 墓碑不早于桶更新时间时该桶不再复活.
 */

import { BUCKET_FILE_VERSION, FAILED_TASK_LIMIT, PENDING_QUEUE_LIMIT, REPORT_LOG_LIMIT } from '../constants'
import type { PendingHeartbeatEntry } from '../heartbeat'
import type { StatsTotals } from '../stats'
import type { BucketFile, DataBucket } from './types'

/* 累计量字段键(与 StatsTotals 一致) */
const TOTAL_KEYS = [
  'heartbeats', 'toolCalls', 'userMessages', 'inputTokens', 'outputTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'promptChars',
  'promptTokens', 'thinkingMs',
] as const satisfies readonly (keyof StatsTotals)[]

/* 按标识合并列表:磁盘条目在前, 仅追加本进程新增的条目, 超出上限时保留尾部 */
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

/* 待发送队列条目的标识:心跳自身身份(时间 + 实体 + 类型)在队列内唯一, 无独立 id 字段 */
function heartbeatKeyOf(entry: PendingHeartbeatEntry): string {
  return `${entry.heartbeat.time}|${entry.heartbeat.entity}|${entry.heartbeat.type}`
}

/* 累计量合并:磁盘值 + 本进程增量(基线为空时按 0 处理) */
function mergeStats(disk: StatsTotals | undefined, memory: StatsTotals | undefined, baseline: StatsTotals | undefined): StatsTotals {
  const totals = {} as StatsTotals
  for (const key of TOTAL_KEYS) {
    const diskValue = disk?.[key] ?? 0
    const delta = (memory?.[key] ?? 0) - (baseline?.[key] ?? 0)
    totals[key] = Math.max(0, diskValue + Math.max(0, delta))
  }
  return totals
}

/* 合并单个桶 */
function mergeBucket(disk: DataBucket | undefined, memory: DataBucket | undefined, baseline: DataBucket | undefined): DataBucket {
  const cloud = (() => {
    const diskCloud = disk?.cloud ?? null
    const memoryCloud = memory?.cloud ?? null
    if (!diskCloud) return memoryCloud
    if (!memoryCloud) return diskCloud
    return memoryCloud.syncedAt >= diskCloud.syncedAt ? memoryCloud : diskCloud
  })()
  const maskedKey = memory?.maskedKey && memory.maskedKey.length > 0 ? memory.maskedKey : disk?.maskedKey
  return {
    updatedAt: Math.max(disk?.updatedAt ?? 0, memory?.updatedAt ?? 0),
    ...(maskedKey === undefined ? {} : { maskedKey }),
    stats: mergeStats(disk?.stats, memory?.stats, baseline?.stats),
    cloud,
    pending: {
      queue: mergeList(disk?.pending.queue ?? [], memory?.pending.queue ?? [], baseline?.pending.queue ?? [], heartbeatKeyOf, PENDING_QUEUE_LIMIT),
      failed: mergeList(disk?.pending.failed ?? [], memory?.pending.failed ?? [], baseline?.pending.failed ?? [], (item) => item.id, FAILED_TASK_LIMIT),
      report: mergeList(disk?.pending.report ?? [], memory?.pending.report ?? [], baseline?.pending.report ?? [], (item) => item.id, REPORT_LOG_LIMIT),
    },
  }
}

/* 合并整个桶文件:disk 为磁盘现值, memory 为本进程内存, baseline 为本进程上次落盘的内容 */
export function mergeBucketFiles(disk: BucketFile, memory: BucketFile, baseline: BucketFile): BucketFile {
  const tombstones: Record<string, number> = { ...(disk.tombstones ?? {}) }
  for (const [key, ts] of Object.entries(memory.tombstones ?? {})) {
    tombstones[key] = Math.max(tombstones[key] ?? 0, ts)
  }
  const buckets: Record<string, DataBucket> = {}
  const keys = new Set([...Object.keys(disk.buckets), ...Object.keys(memory.buckets)])
  for (const key of keys) {
    const diskBucket = disk.buckets[key]
    const memoryBucket = memory.buckets[key]
    if (!diskBucket && !memoryBucket) continue
    const updatedAt = Math.max(diskBucket?.updatedAt ?? 0, memoryBucket?.updatedAt ?? 0)
    /* 墓碑优先:删除时刻不早于最后一次更新时, 该桶保持删除状态 */
    const tomb = tombstones[key] ?? 0
    if (tomb > 0 && tomb >= updatedAt) continue
    buckets[key] = mergeBucket(diskBucket, memoryBucket, baseline.buckets[key])
  }
  /* 一律写当前文件版本:旧版文件(无墓碑字段)写入一次即完成升级 */
  return { version: BUCKET_FILE_VERSION, buckets, tombstones }
}

/* 自检:合并结果不得让任何已存在的桶消失或累计量变小(防合并逻辑错误写坏数据) */
export function isMergeSane(disk: BucketFile, merged: BucketFile): boolean {
  for (const [key, diskBucket] of Object.entries(disk.buckets)) {
    const mergedBucket = merged.buckets[key]
    if (!mergedBucket) {
      const tomb = merged.tombstones?.[key] ?? 0
      if (tomb < diskBucket.updatedAt) return false
      continue
    }
    for (const metric of TOTAL_KEYS) {
      if (mergedBucket.stats[metric] < diskBucket.stats[metric]) return false
    }
  }
  return true
}
