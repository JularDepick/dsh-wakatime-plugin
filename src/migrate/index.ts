/*
 * 0.3.0 -> 0.4.0 数据迁移(一次性, 可整体删除)
 * 作者: JularDepick
 *
 * 本模块把旧结构转换为当前结构, 是全项目唯一保留旧格式知识的地方:
 * - 配置: 0.3.0 的 credentials 列表 + activeCredentialId(以及更早的 apiKey / oauthToken
 *   单字段)、0.4.x 的单份 credential 都转换为当前的双槽凭证 — 插件密钥(API Key)进写入槽,
 *   OAuth 令牌进读取槽; 两槽缺失时按未配置处理;
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
import { normalizeSettings } from '../config-manager/merge'
import type { StoredConfig } from '../config-manager/types'
import { detectCredentialType } from '../credential-format'
import type { PendingHeartbeatEntry, ReportEntry } from '../heartbeat'
import { normalizePendingState } from '../heartbeat'
import { emptyStore, normalizeCloud } from '../local-store/normalize'
import { mergeSameIdentity } from '../heartbeat/compress'
import { heartbeatMergeKeyOf } from '../heartbeat/identity'
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

/* 旧凭证条目里可复用的账号信息 */
interface LegacyToken {
  secret: string
  updatedAt: number
  userId?: string
  username?: string
}

/* 旧配置里挑出一份指定类型的凭证: 激活项优先, 其次同类型的任一激活条目, 最后旧版单字段.
   0.3.0 同时存在插件密钥(api_key)与 OAuth 令牌, 在 0.5.0 的双槽模型里正好分别落到写入槽与读取槽 */
function pickLegacyByType(raw: Record<string, unknown>, type: 'oauth' | 'api_key'): LegacyToken | undefined {
  const records = Array.isArray(raw.credentials) ? raw.credentials : []
  const entries = records
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({ record: item, type: item.type, secret: typeof item.secret === 'string' ? item.secret : '', updatedAt: numberOr(item.lastUsedAt) }))
  const activeId = typeof raw.activeCredentialId === 'string' ? raw.activeCredentialId : undefined
  const active = entries.find((entry) => entry.record.id === activeId) ?? entries[entries.length - 1]
  const chosen = active?.type === type ? active : entries.find((entry) => entry.type === type)
  /* 列表条目的 type 是旧版本自己写的, 不能直接采信: 形态不符的条目迁过去只会变成
     "已配置但恒 401/403", 故与单字段分支同样过一遍识别 */
  const chosenShape = chosen === undefined ? undefined : detectCredentialType(chosen.secret)
  if (chosen && chosen.secret !== '' && chosenShape?.ok === true && chosenShape.type === type) {
    const userId = typeof chosen.record.userId === 'string' && chosen.record.userId !== '' ? chosen.record.userId : undefined
    const username = typeof chosen.record.username === 'string' && chosen.record.username !== '' ? chosen.record.username : undefined
    return {
      secret: chosen.secret.trim(),
      updatedAt: chosen.updatedAt,
      ...(userId === undefined ? {} : { userId }),
      ...(username === undefined ? {} : { username }),
    }
  }
  /* 更早版本把凭证写成顶层单字段: oauthToken / apiKey */
  const singleField = type === 'oauth' ? raw.oauthToken : raw.apiKey
  const single = typeof singleField === 'string' ? singleField.trim() : ''
  if (single === '') return undefined
  const detection = detectCredentialType(single)
  if (!detection.ok || detection.type !== type) return undefined
  return { secret: single.trim(), updatedAt: 0 }
}

/* 0.4.x 结构(version 3, 单份 OAuth 令牌) -> 0.5.0 结构(version 4, 双槽):
   旧令牌是个人 OAuth 令牌, 只有读权限, 故落到读取槽; 写入槽留空等用户另填 API Key;
   settings 只搬运显式改过的键(不补默认值, 否则会盖掉 cordis.yml 的同名项);
   本地数据(战绩与待发送队列)与凭证无关, 不在此模块处理 */
function migrateV3Config(record: Record<string, unknown>): StoredConfig | null {
  if (record.version !== 3) return null
  const raw = typeof record.credential === 'object' && record.credential !== null
    ? record.credential as Record<string, unknown>
    : {}
  const secret = typeof raw.secret === 'string' ? raw.secret.trim() : ''
  const updatedAt = numberOr(raw.updatedAt, numberOr(record.credentialUpdatedAt, Date.now()))
  return {
    version: CONFIG_FILE_VERSION,
    settings: normalizeSettings(record.settings) ?? {},
    ...(secret === '' ? {} : { readCredential: { secret, type: 'oauth' as const, updatedAt } }),
    ...(secret === '' ? {} : { readCredentialUpdatedAt: updatedAt }),
    writeCredentialUpdatedAt: 0,
    ...(typeof record.settingsUpdatedAt === 'number' ? { settingsUpdatedAt: numberOr(record.settingsUpdatedAt, 0) } : {}),
    ...(typeof record.userId === 'string' && record.userId !== '' ? { userId: record.userId } : {}),
    ...(typeof record.username === 'string' && record.username !== '' ? { username: record.username } : {}),
    ...(typeof record.accountUpdatedAt === 'number' ? { accountUpdatedAt: numberOr(record.accountUpdatedAt, 0) } : {}),
  }
}

/* 旧配置迁移; 非旧结构返回 null */
export function migrateStoredConfig(raw: unknown): StoredConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  /* 0.4.x 的单令牌结构优先按版本号识别, 再回落到更早版本的字段特征 */
  const v3 = migrateV3Config(record)
  if (v3 !== null) return v3
  const isLegacy = Array.isArray(record.credentials) || typeof record.oauthToken === 'string' || typeof record.apiKey === 'string'
  if (!isLegacy) return null
  /* settings 只搬运显式改过的键: 补默认值等于替用户做了"界面写入", 会把 cordis.yml 的同名项钉死 */
  const settings = normalizeSettings(record.settings) ?? {}
  const now = Date.now()
  /* 0.3.0 的两类凭证在 0.5.0 的双槽里各有归宿: OAuth 令牌 -> 读取槽, 插件密钥 -> 写入槽 */
  const read = pickLegacyByType(record, 'oauth')
  const write = pickLegacyByType(record, 'api_key')
  const readAt = read === undefined ? 0 : (read.updatedAt || now)
  const writeAt = write === undefined ? 0 : (write.updatedAt || now)
  return {
    version: CONFIG_FILE_VERSION,
    settings,
    ...(read === undefined ? {} : { readCredential: { secret: read.secret, type: 'oauth' as const, updatedAt: readAt } }),
    readCredentialUpdatedAt: readAt,
    ...(write === undefined ? {} : { writeCredential: { secret: write.secret, type: 'api_key' as const, updatedAt: writeAt } }),
    writeCredentialUpdatedAt: writeAt,
    settingsUpdatedAt: numberOr(record.settingsUpdatedAt, now),
    ...(typeof record.userId === 'string' && record.userId !== ''
      ? { userId: record.userId }
      : (read?.userId === undefined ? {} : { userId: read.userId })),
    ...(typeof record.username === 'string' && record.username !== ''
      ? { username: record.username }
      : (read?.username === undefined ? {} : { username: read.username })),
    accountUpdatedAt: numberOr(record.settingsUpdatedAt, now),
  }
}

/* 列表去重(保留最后一次出现的条目)并截断到上限 */
function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string, limit: number): T[] {
  const map = new Map<string, T>()
  for (const item of items) map.set(keyOf(item), item)
  return [...map.values()].slice(-limit)
}

/* 待发送队列去重: 同身份的两条是同一毫秒的同一条活动, 计数相加而不是整条丢弃,
   否则 0.3.0 期间产生的重复心跳会连带丢掉其中一条的 Token 与提示词计数 */
function mergeQueue(items: readonly PendingHeartbeatEntry[], limit: number): PendingHeartbeatEntry[] {
  const map = new Map<string, PendingHeartbeatEntry>()
  for (const item of items) {
    /* 与入队/落盘同一套键(身份 + 项目 + 分支): 迁移时也不该把跨项目的同秒工具心跳并成一条 */
    const key = heartbeatMergeKeyOf(item)
    const existing = map.get(key)
    map.set(key, existing === undefined ? item : mergeSameIdentity(existing, item))
  }
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
      queue: mergeQueue(queue, PENDING_QUEUE_LIMIT),
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
