/*
 * 本地数据归一化
 * 作者: JularDepick
 *
 * 只接受当前结构版本;损坏字段按空值补齐, 不污染统计与上报.
 */

import { normalizePendingState } from '../heartbeat'
import { emptyTotals, normalizeTotals } from '../stats'
import { STORE_FILE_VERSION } from '../constants'
import type { CloudSummary } from '../sync'
import type { StoreFile } from './types'

/* 空存储 */
export function emptyStore(): StoreFile {
  return {
    version: STORE_FILE_VERSION,
    updatedAt: 0,
    stats: emptyTotals(),
    cloud: null,
    pending: { queue: [], failed: [], report: [] },
  }
}

/* 云端快照归一化:字段缺失或非法时按 0,整体不可用时返回 null */
export function normalizeCloud(value: unknown): CloudSummary | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const num = (key: string): number => {
    const field = raw[key]
    return typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : 0
  }
  const syncedAt = num('syncedAt')
  if (syncedAt <= 0) return null
  return {
    syncedAt,
    inputTokens: num('inputTokens'),
    cachedInputTokens: num('cachedInputTokens'),
    outputTokens: num('outputTokens'),
    promptChars: num('promptChars'),
    sessions: num('sessions'),
    promptEvents: num('promptEvents'),
  }
}

/* 当前结构版本归一化;版本不符返回 null(交给迁移模块或按空数据处理) */
export function normalizeStore(value: unknown): StoreFile | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== STORE_FILE_VERSION) return null
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  return {
    version: STORE_FILE_VERSION,
    updatedAt,
    stats: normalizeTotals(raw.stats),
    cloud: normalizeCloud(raw.cloud),
    pending: normalizePendingState(raw.pending),
  }
}
