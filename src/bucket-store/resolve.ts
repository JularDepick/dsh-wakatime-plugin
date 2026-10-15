/*
 * 战绩显示策略解析
 * 作者: JularDepick
 *
 * 桶内合并 + 跨桶汇总:
 * - 桶内:该 Key 的本地累计量与它自己的云端快照逐项取最大值
 *   (提示词字符、输入 TOKEN、输出 TOKEN),其余本地独有指标(思考时长、提示词 Token 估算)直接用本地值;
 * - 跨桶:按显示策略选取参与统计的桶(全部密钥 = 所有桶,当前密钥 = 当前桶),逐项求和。
 * 这样云端数据只影响它所属的 Key 的桶,不跨账号混算。
 */

import type { StatsScope } from '../config'
import type { SessionStats, StatsTotals } from '../stats'
import type { CloudSummary } from '../sync'
import type { DataBucket } from './types'

/* 累计量字段键(与 StatsTotals 一致,全部为数值) */
const TOTAL_KEYS = [
  'heartbeats', 'toolCalls', 'userMessages', 'inputTokens', 'outputTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'promptChars',
  'promptTokens', 'thinkingMs',
] as const satisfies readonly (keyof StatsTotals)[]

/* 空累计量 */
function emptyTotalsValue(): StatsTotals {
  const totals = {} as StatsTotals
  for (const key of TOTAL_KEYS) totals[key] = 0
  return totals
}

/* 桶内合并:本地累计量与云端快照逐项取最大 */
function mergeBucket(bucket: DataBucket): StatsTotals {
  const local = bucket.stats
  const cloud = bucket.cloud
  const totals = { ...local }
  totals.inputTokens = Math.max(local.inputTokens, cloud?.inputTokens ?? 0)
  totals.outputTokens = Math.max(local.outputTokens, cloud?.outputTokens ?? 0)
  totals.promptChars = Math.max(local.promptChars, cloud?.promptChars ?? 0)
  return totals
}

/* 战绩视图:参与统计的桶数量、合并后的累计量与最新云端快照 */
export interface StatsView {
  scope: StatsScope
  bucketCount: number
  aggregate: SessionStats
  cloud: CloudSummary | null
}

/* 按策略解析战绩视图;当前密钥无桶时返回全零视图 */
export function resolveStatsView(
  buckets: Readonly<Record<string, DataBucket>>,
  scope: StatsScope,
  currentKey: string,
): StatsView {
  const keys = Object.keys(buckets)
  const selected = scope === 'current' ? keys.filter((key) => key === currentKey) : keys
  const totals = emptyTotalsValue()
  let cloud: CloudSummary | null = null
  for (const key of selected) {
    const bucket = buckets[key]
    if (!bucket) continue
    const merged = mergeBucket(bucket)
    for (const field of TOTAL_KEYS) totals[field] += merged[field]
    if (bucket.cloud && (cloud === null || bucket.cloud.syncedAt > cloud.syncedAt)) cloud = bucket.cloud
  }
  return {
    scope,
    bucketCount: selected.length,
    aggregate: { sessionId: '(scope)', lastPromptLength: 0, ...totals },
    cloud,
  }
}
