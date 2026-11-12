/*
 * 待发送队列压缩
 * 作者: JularDepick
 *
 * 仅在队列超过上限时启用的降级手段:把相邻两条任务合并成一条,
 * 保留较早那条的身份(entity/类型/项目/分支/语言/会话/机器)与时间戳,
 * AI 计数(输入 TOKEN、输出 TOKEN、提示词长度、行变动)相加,
 * 从而在不丢 AI 指标的前提下把队列规模折半。
 * 编码时长依据的心跳时间戳会因此变稀疏,故只在超限时触发,正常推送路径不做任何压缩。
 */

import { FAILED_TASK_LIMIT, REPORT_LOG_LIMIT } from '../constants'
import type { Heartbeat, PendingHeartbeatEntry, ReportEntry } from './types'

/* 两个可选计数相加:都为 undefined 时保持 undefined */
function addCounter(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined
  return (left ?? 0) + (right ?? 0)
}

/* 合并两条的公共实现: 身份与时间取较早那条, AI 计数相加, 尝试次数由调用方给出口径 */
function mergeEntries(
  earlier: PendingHeartbeatEntry,
  later: PendingHeartbeatEntry,
  combineAttempts: (left: number, right: number) => number,
): PendingHeartbeatEntry {
  const base = earlier.heartbeat
  const merged: Heartbeat = { ...base }
  const inputTokens = addCounter(base.ai_input_tokens, later.heartbeat.ai_input_tokens)
  const outputTokens = addCounter(base.ai_output_tokens, later.heartbeat.ai_output_tokens)
  const promptLength = addCounter(base.ai_prompt_length, later.heartbeat.ai_prompt_length)
  const lineChanges = addCounter(base.ai_line_changes, later.heartbeat.ai_line_changes)
  const cachedInputTokens = addCounter(base.ai_cached_input_tokens, later.heartbeat.ai_cached_input_tokens)
  if (inputTokens !== undefined) merged.ai_input_tokens = inputTokens
  if (outputTokens !== undefined) merged.ai_output_tokens = outputTokens
  if (promptLength !== undefined) merged.ai_prompt_length = promptLength
  if (lineChanges !== undefined) merged.ai_line_changes = lineChanges
  if (cachedInputTokens !== undefined) merged.ai_cached_input_tokens = cachedInputTokens
  return {
    heartbeat: merged,
    enqueuedAt: Math.min(earlier.enqueuedAt, later.enqueuedAt),
    attempts: combineAttempts(earlier.attempts, later.attempts),
  }
}

/* 合并相邻两条: 身份与时间取较早那条, AI 计数相加.
   供队列超限压缩使用: 两条可能是不同时间的心跳, 尝试次数取较大者(这一批确实已被尝试过) */
export function mergeAdjacentEntries(earlier: PendingHeartbeatEntry, later: PendingHeartbeatEntry): PendingHeartbeatEntry {
  return mergeEntries(earlier, later, Math.max)
}

/* 合并同身份的两条(入队去重, 载入与落盘归并): 计数相加, 身份取较早那条.
   尝试次数取较小值: 新条目没有被尝试过, 让它继承旧条目的次数会让合并后的心跳提前耗尽重试 */
export function mergeSameIdentity(left: PendingHeartbeatEntry, right: PendingHeartbeatEntry): PendingHeartbeatEntry {
  const [earlier, later] = left.enqueuedAt <= right.enqueuedAt ? [left, right] : [right, left]
  return mergeEntries(earlier, later, Math.min)
}

/* 上报记录按类别分别截断: 任务行是失败任务在界面上唯一的重试入口,
   与批次行共用一个上限会在积压场景下把它挤掉, 故任务行用失败列表的上限, 批次行用记录上限 */
export function trimReportLog(
  entries: readonly ReportEntry[],
  taskLimit: number = FAILED_TASK_LIMIT,
  batchLimit: number = REPORT_LOG_LIMIT,
): ReportEntry[] {
  const tasks: ReportEntry[] = []
  const batches: ReportEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'task') tasks.push(entry)
    else batches.push(entry)
  }
  return [...tasks.slice(-taskLimit), ...batches.slice(-batchLimit)]
}

/* 压缩结果:压缩后的队列与发生的合并次数 */
export interface CompressResult {
  queue: PendingHeartbeatEntry[]
  merged: number
}

/* 按队列位置做"相邻两条合并", 只合并到刚好不超过上限:
   整轮折半会为腾出几条位置牺牲掉大量心跳的原始时间戳(编码时长分布变粗), 故只合并必要的条数 */
export function compressPendingQueue(queue: readonly PendingHeartbeatEntry[], limit: number): CompressResult {
  if (queue.length <= limit) return { queue: [...queue], merged: 0 }
  const need = queue.length - limit
  const next: PendingHeartbeatEntry[] = []
  let merged = 0
  let index = 0
  while (index < queue.length) {
    const first = queue[index]
    if (first === undefined) break
    const second = queue[index + 1]
    if (merged < need && second !== undefined) {
      next.push(mergeAdjacentEntries(first, second))
      merged += 1
      index += 2
      continue
    }
    next.push(first)
    index += 1
  }
  return { queue: next, merged }
}
