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

import { FAILED_TASK_LIMIT, PENDING_QUEUE_LIMIT, STORE_FILE_VERSION } from '../constants'
import { compressPendingQueue, mergeSameIdentity, trimReportLog } from '../heartbeat/compress'
import type { PendingHeartbeatEntry } from '../heartbeat'
import type { StatsTotals } from '../stats'
import { heartbeatMergeKeyOf } from '../heartbeat/identity'
import type { StoreFile } from './types'

/* 累计量字段键(与 StatsTotals 一致) */
const TOTAL_KEYS = [
  'heartbeats', 'toolCalls', 'userMessages', 'inputTokens', 'outputTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'promptChars',
  'promptTokens', 'thinkingMs',
] as const satisfies readonly (keyof StatsTotals)[]

/* 列表合并选项: 上限、超限时的压缩手段、被丢弃条数的通知, 以及同键条目相遇时的归并手段 */
interface MergeListOptions<T> {
  limit?: number
  compress?: (items: readonly T[]) => T[]
  onDrop?: (count: number) => void
  merge?: (left: T, right: T) => T
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
  const { limit, compress, onDrop, merge } = options
  /* 内存侧同键先归并(队列按计数相加), 否则同键条目只会留下最后一个 */
  const liveByKey = new Map<string, T>()
  for (const item of memory) {
    const key = keyOf(item)
    const existing = liveByKey.get(key)
    liveByKey.set(key, existing === undefined || merge === undefined ? item : merge(existing, item))
  }
  /* 磁盘侧同键先去重: 旧版本写下的同毫秒重复心跳各带自己的计数, 原样保留会被当成不同心跳重复上报.
     去重只在磁盘侧内部做, 不与内存侧相加: 内存侧已经是同一批心跳的合并结果, 再叠加会翻倍 */
  const diskByKey = new Map<string, T>()
  for (const item of disk) {
    const key = keyOf(item)
    const existing = diskByKey.get(key)
    if (existing === undefined) diskByKey.set(key, item)
    else if (merge !== undefined) diskByKey.set(key, merge(existing, item))
  }
  const baseKeys = new Set(baseline.map(keyOf))
  const removed = new Set([...baseKeys].filter((key) => !liveByKey.has(key)))
  const known = new Set<string>()
  let result: T[] = []
  for (const [key, item] of diskByKey) {
    if (removed.has(key)) continue
    result.push(liveByKey.get(key) ?? item)
    known.add(key)
  }
  /* 追加本进程新增的条目: 只以"磁盘上有没有"为判据.
     若再要求"不在基线里", 磁盘侧压缩(相邻两条合并会把后一条的键吃掉)或超限截断
     就会让本进程仍在内存里的条目永远写不回去 */
  for (const item of memory) {
    const key = keyOf(item)
    if (known.has(key)) continue
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
  /* 上报记录: 任务行与批次行各按自己的上限截断(任务行是重试入口, 不能被批次行挤掉),
     先按 id 合并再分类截断, 被丢弃的条数仍按原有口径通知出去 */
  const reportMerged = mergeList(disk.pending.report, memory.pending.report, baseline.pending.report, (item) => item.id)
  const report = trimReportLog(reportMerged)
  if (report.length < reportMerged.length) reportDrop(reportMerged.length - report.length)
  return {
    version: STORE_FILE_VERSION,
    updatedAt: Math.max(disk.updatedAt, memory.updatedAt),
    stats: mergeStats(disk.stats, memory.stats, baseline.stats),
    cloud: mergeCloud(disk.cloud, memory.cloud, baseline.cloud),
    pending: {
      /* 与入队归并共用同一套键(身份 + 项目 + 分支): 用更宽的身份键会把跨项目/分支的同秒工具心跳并成一条 */
      queue: mergeList(disk.pending.queue, memory.pending.queue, baseline.pending.queue, heartbeatMergeKeyOf, {
        limit: PENDING_QUEUE_LIMIT,
        compress: (items) => compressPendingQueue(items, PENDING_QUEUE_LIMIT).queue,
        onDrop: queueDrop,
        merge: mergeSameIdentity,
      }),
      failed: mergeList(disk.pending.failed, memory.pending.failed, baseline.pending.failed, (item) => item.id, {
        limit: FAILED_TASK_LIMIT,
        onDrop: failedDrop,
      }),
      report,
    },
  }
}

export type { PendingHeartbeatEntry }
