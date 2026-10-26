/*
 * 战绩显示策略解析
 * 作者: JularDepick
 *
 * 桶内合并 + 跨桶汇总:
 * - 桶内:该凭证的本地累计量与它自己的云端快照逐项取最大值
 *   (提示词字符、输入 TOKEN、输出 TOKEN),其余本地独有指标(思考时长、提示词 Token 估算)直接用本地值;
 * - 云端去重:同一 WakaTime 账号可能保存多份凭证, 而 summaries 取的是账号级聚合,
 *   故按桶内账号标识(accountId)去重, 同账号只采纳同步时刻最新的一份参与合并, 避免重复计入;
 * - 跨桶:按显示策略选取参与统计的桶(全部 = 所有桶, 当前 = 当前桶),逐项求和。
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

/* 账号键:有账号标识用账号, 否则退回桶标识(孤儿桶按独立账号处理) */
function accountKeyOf(bucket: DataBucket, key: string): string {
  return bucket.accountId !== undefined && bucket.accountId !== '' ? bucket.accountId : key
}

/* 取每个账号最近的云端快照, 供跨桶合并时去重 */
function pickCloudByAccount(
  buckets: Readonly<Record<string, DataBucket>>,
  selected: readonly string[],
): Map<string, CloudSummary> {
  const chosen = new Map<string, CloudSummary>()
  for (const key of selected) {
    const bucket = buckets[key]
    const cloud = bucket?.cloud
    if (!bucket || !cloud) continue
    const existing = chosen.get(accountKeyOf(bucket, key))
    if (!existing || cloud.syncedAt > existing.syncedAt) chosen.set(accountKeyOf(bucket, key), cloud)
  }
  return chosen
}

/* 桶内合并:本地累计量与云端快照逐项取最大;cloud 为空时只用本地值 */
function mergeBucket(bucket: DataBucket, cloud: CloudSummary | null): StatsTotals {
  const local = bucket.stats
  const totals = { ...local }
  totals.inputTokens = Math.max(local.inputTokens, cloud?.inputTokens ?? 0)
  totals.outputTokens = Math.max(local.outputTokens, cloud?.outputTokens ?? 0)
  totals.promptChars = Math.max(local.promptChars, cloud?.promptChars ?? 0)
  return totals
}

/* 战绩视图:参与统计的桶数量、合并后的累计量与最新云端快照 */
export interface StatsView {
  scope: StatsScope
  aggregate: SessionStats
  cloud: CloudSummary | null
}

/* 按策略解析战绩视图;当前凭证无桶时返回全零视图 */
export function resolveStatsView(
  buckets: Readonly<Record<string, DataBucket>>,
  scope: StatsScope,
  currentKey: string,
): StatsView {
  const keys = Object.keys(buckets)
  const selected = scope === 'current' ? keys.filter((key) => key === currentKey) : keys
  const totals = emptyTotalsValue()
  const cloudByAccount = pickCloudByAccount(buckets, selected)
  let cloud: CloudSummary | null = null
  for (const key of selected) {
    const bucket = buckets[key]
    if (!bucket) continue
    /* 同账号只让最近同步的那份快照参与合并, 其余桶只用本地累计量 */
    const candidate = cloudByAccount.get(accountKeyOf(bucket, key)) ?? null
    const ownCloud = candidate !== null && bucket.cloud !== null && candidate.syncedAt === bucket.cloud.syncedAt
      ? bucket.cloud
      : null
    const merged = mergeBucket(bucket, ownCloud)
    for (const field of TOTAL_KEYS) totals[field] += merged[field]
    if (bucket.cloud && (cloud === null || bucket.cloud.syncedAt > cloud.syncedAt)) cloud = bucket.cloud
  }
  return {
    scope,
    aggregate: { sessionId: '(scope)', lastPromptLength: 0, ...totals },
    cloud,
  }
}
