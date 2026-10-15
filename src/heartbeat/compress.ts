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

import type { Heartbeat, PendingHeartbeatEntry } from './types'

/* 两个可选计数相加:都为 undefined 时保持 undefined */
function addCounter(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined
  return (left ?? 0) + (right ?? 0)
}

/* 合并相邻两条:身份与时间取较早那条,AI 计数相加 */
export function mergeAdjacentEntries(earlier: PendingHeartbeatEntry, later: PendingHeartbeatEntry): PendingHeartbeatEntry {
  const base = earlier.heartbeat
  const merged: Heartbeat = { ...base }
  const inputTokens = addCounter(base.ai_input_tokens, later.heartbeat.ai_input_tokens)
  const outputTokens = addCounter(base.ai_output_tokens, later.heartbeat.ai_output_tokens)
  const promptLength = addCounter(base.ai_prompt_length, later.heartbeat.ai_prompt_length)
  const lineChanges = addCounter(base.ai_line_changes, later.heartbeat.ai_line_changes)
  const cacheReadTokens = addCounter(base.ai_cache_read_tokens, later.heartbeat.ai_cache_read_tokens)
  if (inputTokens !== undefined) merged.ai_input_tokens = inputTokens
  if (outputTokens !== undefined) merged.ai_output_tokens = outputTokens
  if (promptLength !== undefined) merged.ai_prompt_length = promptLength
  if (lineChanges !== undefined) merged.ai_line_changes = lineChanges
  if (cacheReadTokens !== undefined) merged.ai_cache_read_tokens = cacheReadTokens
  return {
    heartbeat: merged,
    enqueuedAt: Math.min(earlier.enqueuedAt, later.enqueuedAt),
    attempts: Math.max(earlier.attempts, later.attempts),
  }
}

/* 压缩结果:压缩后的队列与发生的合并次数 */
export interface CompressResult {
  queue: PendingHeartbeatEntry[]
  merged: number
}

/* 反复做一遍"相邻两条合并",直到不超过上限或无法继续 */
export function compressPendingQueue(queue: readonly PendingHeartbeatEntry[], limit: number): CompressResult {
  let current = [...queue]
  let merged = 0
  while (current.length > limit && current.length > 1) {
    const next: PendingHeartbeatEntry[] = []
    for (let index = 0; index < current.length; index += 2) {
      const first = current[index]
      const second = current[index + 1]
      if (first === undefined) break
      if (second === undefined) {
        next.push(first)
        continue
      }
      next.push(mergeAdjacentEntries(first, second))
      merged += 1
    }
    current = next
  }
  return { queue: current, merged }
}
