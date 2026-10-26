/*
 * 战绩视图解析
 * 作者: JularDepick
 *
 * 本地累计量与云端快照逐项取最大值(提示词字符、输入 TOKEN、输出 TOKEN、缓存命中 TOKEN),
 * 其余指标(思考时长、提示词 Token 估算、缓存写入与推理 TOKEN)官方无对应字段,
 * 直接用本地值, 也不参与云端拉取.
 */

import type { SessionStats, StatsTotals } from '../stats'
import type { CloudSummary } from '../sync'
import type { StoreFile } from './types'

/* 本地与云端逐项取最大 */
function mergeWithCloud(local: StatsTotals, cloud: CloudSummary | null): StatsTotals {
  const totals = { ...local }
  totals.inputTokens = Math.max(local.inputTokens, cloud?.inputTokens ?? 0)
  totals.cacheReadTokens = Math.max(local.cacheReadTokens, cloud?.cachedInputTokens ?? 0)
  totals.outputTokens = Math.max(local.outputTokens, cloud?.outputTokens ?? 0)
  totals.promptChars = Math.max(local.promptChars, cloud?.promptChars ?? 0)
  return totals
}

/* 战绩视图:合并后的累计量与最新云端快照 */
export interface StatsView {
  aggregate: SessionStats
  cloud: CloudSummary | null
}

/* 解析战绩视图 */
export function resolveStatsView(file: StoreFile): StatsView {
  const totals = mergeWithCloud(file.stats, file.cloud)
  return {
    aggregate: { sessionId: 'local', lastPromptLength: 0, ...totals },
    cloud: file.cloud,
  }
}
