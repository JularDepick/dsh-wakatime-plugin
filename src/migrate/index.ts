/*
 * 0.3.0 -> 0.4.0 数据迁移(一次性, 可整体删除)
 * 作者: JularDepick
 *
 * 本模块把旧结构转换为当前结构, 是全项目唯一保留旧格式知识的地方:
 * - 配置: 0.3.0 的 credentials 列表 + activeCredentialId(以及更早的 apiKey / oauthToken
 *   单字段)转换为单份 OAuth 凭证; 插件密钥不再支持, 找不到 OAuth 令牌时按未配置处理;
 * - 数据: 0.3.0 的分凭证数据桶(buckets)合并为单份本地数据, 累计量逐项求和、
 *   队列/失败/记录按标识去重合并、云端快照取 syncedAt 最新的一份;
 * - 更早版本: 独立快照 stats.json / heartbeats.json 在数据文件缺失时并入.
 *
 * 解耦约定: 调用方只在"当前结构归一化失败"时调用本模块的函数,
 * 删除本目录并去掉那处调用即可彻底放弃旧数据兼容(旧文件会被当作未配置/空数据).
 */

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_FILE_VERSION,
  LEGACY_HEARTBEAT_FILE_NAME,
  LEGACY_STATS_FILE_NAME,
  PENDING_QUEUE_LIMIT,
  REPORT_LOG_LIMIT,
  STORE_FILE_VERSION,
} from '../constants'
import type { StoredConfig, StoredSettings } from '../config-manager/types'
import { detectCredentialType } from '../credential-format'
import type { PendingHeartbeatEntry, ReportEntry } from '../heartbeat'
import { normalizePendingState } from '../heartbeat'
import { emptyStore, normalizeCloud } from '../local-store/normalize'
import { heartbeatKeyOf } from '../heartbeat/identity'
import type { StoreFile } from '../local-store/types'
import { archiveFile } from '../storage'
import { emptyTotals, normalizeTotals } from '../stats'
import type { StatsTotals } from '../stats'

/* 累计量字段键(与 StatsTotals 一致) */
const TOTAL_KEYS = [
  'heartbeats', 'toolCalls', 'userMessages', 'inputTokens', 'outputTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'promptChars',
  'promptTokens', 'thinkingMs',
] as const satisfies readonly (keyof StatsTotals)[]

/* 数字字段尽力归一 */
function numberOr(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/* 旧 settings 迁移: 只保留当前仍存在的键(statsScope 随多凭证一起下线) */
function migrateSettings(value: unknown): StoredSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    reportInterval: typeof raw.reportInterval === 'number' && raw.reportInterval >= 1 ? raw.reportInterval : 60,
    reportEnabled: typeof raw.reportEnabled === 'boolean' ? raw.reportEnabled : true,
    includeTokens: typeof raw.includeTokens === 'boolean' ? raw.includeTokens : true,
    includePrompts: typeof raw.includePrompts === 'boolean' ? raw.includePrompts : true,
    debug: typeof raw.debug === 'boolean' ? raw.debug : false,
    ...(typeof raw.tableBorders === 'boolean' ? { tableBorders: raw.tableBorders } : {}),
    ...(raw.digitGrouping === 'thousand' || raw.digitGrouping === 'myriad' ? { digitGrouping: raw.digitGrouping } : {}),
    ...(typeof raw.locale === 'string' && raw.locale !== '' ? { locale: raw.locale } : {}),
  }
}

/* 旧凭证条目里可复用的账号信息 */
interface LegacyToken {
  secret: string
  updatedAt: number
  userId?: string
  username?: string
}

/* 旧配置里挑出一份 OAuth 凭证: 激活项优先, 其次任一 OAuth 条目, 最后旧版单字段 */
function pickLegacyToken(raw: Record<string, unknown>): LegacyToken | undefined {
  const records = Array.isArray(raw.credentials) ? raw.credentials : []
  const entries = records
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({ record: item, type: item.type, secret: typeof item.secret === 'string' ? item.secret : '', updatedAt: numberOr(item.lastUsedAt) }))
  const activeId = typeof raw.activeCredentialId === 'string' ? raw.activeCredentialId : undefined
  const active = entries.find((entry) => entry.record.id === activeId) ?? entries[entries.length - 1]
  const chosen = active?.type === 'oauth' ? active : entries.find((entry) => entry.type === 'oauth')
  if (chosen && chosen.secret !== '') {
    const userId = typeof chosen.record.userId === 'string' && chosen.record.userId !== '' ? chosen.record.userId : undefined
    const username = typeof chosen.record.username === 'string' && chosen.record.username !== '' ? chosen.record.username : undefined
    return {
      secret: chosen.secret.trim(),
      updatedAt: chosen.updatedAt,
      ...(userId === undefined ? {} : { userId }),
      ...(username === undefined ? {} : { username }),
    }
  }
  const single = typeof raw.oauthToken === 'string' ? raw.oauthToken : ''
  if (single !== '' && detectCredentialType(single).ok) return { secret: single.trim(), updatedAt: 0 }
  return undefined
}

/* 旧配置迁移; 非旧结构返回 null */
export function migrateStoredConfig(raw: unknown): StoredConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const isLegacy = Array.isArray(record.credentials) || typeof record.oauthToken === 'string' || typeof record.apiKey === 'string'
  if (!isLegacy) return null
  const settings = migrateSettings(record.settings)
  const token = pickLegacyToken(record)
  const now = Date.now()
  return {
    version: CONFIG_FILE_VERSION,
    settings,
    ...(token === undefined ? {} : { credential: { secret: token.secret, type: 'oauth' as const, updatedAt: token.updatedAt || now } }),
    credentialUpdatedAt: token === undefined ? undefined : (token.updatedAt || now),
    settingsUpdatedAt: numberOr(record.settingsUpdatedAt, now),
    ...(typeof record.userId === 'string' && record.userId !== ''
      ? { userId: record.userId }
      : (token?.userId === undefined ? {} : { userId: token.userId })),
    ...(typeof record.username === 'string' && record.username !== ''
      ? { username: record.username }
      : (token?.username === undefined ? {} : { username: token.username })),
    accountUpdatedAt: numberOr(record.settingsUpdatedAt, now),
  }
}

/* 列表去重(保留最后一次出现的条目)并截断到上限 */
function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string, limit: number): T[] {
  const map = new Map<string, T>()
  for (const item of items) map.set(keyOf(item), item)
  return [...map.values()].slice(-limit)
}

/* 0.3.0 分凭证数据桶 -> 单份本地数据; 非旧结构返回 null */
export function migrateStoreFile(raw: unknown): StoreFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  /* 只接受 0.3.0 的结构(version 2)或更早的缺省写法;
     其它版本(含未来版本)一律按"不可识别"交给上层归档 */
  const version = record.version
  if (version !== undefined && version !== 2) return null
  const buckets = record.buckets
  if (typeof buckets !== 'object' || buckets === null) return null
  /* 旧文件的删除墓碑:墓碑时刻晚于桶更新时刻的桶视为已删除, 不参与合并 */
  const tombstones = typeof record.tombstones === 'object' && record.tombstones !== null
    ? record.tombstones as Record<string, unknown>
    : {}
  const stats = emptyTotals()
  const queue: PendingHeartbeatEntry[] = []
  const report: ReportEntry[] = []
  let cloud: StoreFile['cloud'] = null
  let updatedAt = 0
  for (const [key, bucket] of Object.entries(buckets as Record<string, unknown>)) {
    if (typeof bucket !== 'object' || bucket === null) continue
    const item = bucket as Record<string, unknown>
    const bucketUpdatedAt = numberOr(item.updatedAt)
    if (numberOr(tombstones[key]) > bucketUpdatedAt) continue
    updatedAt = Math.max(updatedAt, bucketUpdatedAt)
    const totals = normalizeTotals(item.stats)
    for (const key of TOTAL_KEYS) stats[key] += totals[key]
    const bucketCloud = normalizeCloud(item.cloud)
    if (bucketCloud !== null && (cloud === null || bucketCloud.syncedAt > cloud.syncedAt)) cloud = bucketCloud
    const pending = normalizePendingState(item.pending)
    queue.push(...pending.queue)
    /* 旧版本的失败列表不继承: 0.3.0 把凭证被拒(401/403)也当成终态失败,
       迁移过来的任务与当前账号状态无关, 继承只会让升级后满屏都是别人的红色失败行,
       且这些心跳已不在队列, 重试也推不回原本的时间线; 只保留批次级上报记录 */
    report.push(...pending.report.filter((entry) => entry.kind === 'batch'))
  }
  return {
    version: STORE_FILE_VERSION,
    updatedAt,
    stats,
    cloud,
    pending: {
      queue: dedupeBy(queue, heartbeatKeyOf, PENDING_QUEUE_LIMIT),
      /* 失败列表不从旧版本继承, 迁移后为空 */
      failed: [],
      report: dedupeBy(report, (entry) => entry.id, REPORT_LOG_LIMIT),
    },
  }
}

/* 更早版本的独立快照(stats.json / heartbeats.json)并入; 均不存在时返回 null */
export async function loadLegacySnapshots(dir: string): Promise<StoreFile | null> {
  let store: StoreFile | null = null
  const readJson = async (name: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(join(dir, name), 'utf-8')) as unknown
    } catch {
      return undefined
    }
  }
  const stats = normalizeTotals(await readJson(LEGACY_STATS_FILE_NAME))
  const normalized = normalizePendingState(await readJson(LEGACY_HEARTBEAT_FILE_NAME))
  /* 与 v2 数据桶一致: 旧失败列表不继承, 只保留批次级上报记录(任务记录已无对应任务) */
  const pending = {
    queue: normalized.queue,
    failed: [],
    report: normalized.report.filter((entry) => entry.kind === 'batch'),
  }
  const hasStats = TOTAL_KEYS.some((key) => stats[key] > 0)
  const hasPending = pending.queue.length + pending.failed.length + pending.report.length > 0
  if (!hasStats && !hasPending) return null
  store = { ...emptyStore(), stats, pending, updatedAt: Date.now() }
  return store
}

/* 更早版本的独立快照并入成功后归档(重命名为 <文件名>.legacy.<时间戳>.bak):
   归档后原路径不再存在, 下次启动不会重复并入同一份旧数据 */
export async function archiveLegacySnapshots(dir: string): Promise<boolean> {
  let archived = false
  for (const name of [LEGACY_STATS_FILE_NAME, LEGACY_HEARTBEAT_FILE_NAME]) {
    try {
      await access(join(dir, name))
    } catch {
      continue
    }
    if (await archiveFile(join(dir, name), 'legacy')) archived = true
  }
  return archived
}
