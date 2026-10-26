/*
 * 配置文件的跨进程合并
 * 作者: JularDepick
 *
 * 配置写操作以"并集"方式合并, 不做增量运算:
 * - 凭证列表按 id 并集, 同 id 取最近使用时刻较新的一条;
 * - 凭证删除记墓碑(credentialTombstones), 墓碑不早于加入时刻时该凭证不再复活;
 * - 激活凭证由 activeUpdatedAt 决定取舍,切换/新增/清除都会刷新该时刻;
 * - settings 与账号名以本次写入方为准, 其余字段缺失时回退磁盘值.
 */

import type { StoredConfig, StoredCredentialRecord } from './types'

/* 合并墓碑:同名取较新时刻 */
function mergeTombstones(left: Record<string, number> | undefined, right: Record<string, number> | undefined): Record<string, number> {
  const merged: Record<string, number> = { ...(left ?? {}) }
  for (const [id, ts] of Object.entries(right ?? {})) {
    merged[id] = Math.max(merged[id] ?? 0, ts)
  }
  return merged
}

/* 凭证并集:同 id 取 lastUsedAt 较新者;被墓碑覆盖(含已删除)的整条丢弃 */
function mergeCredentials(
  left: readonly StoredCredentialRecord[] | undefined,
  right: readonly StoredCredentialRecord[] | undefined,
  tombstones: Record<string, number>,
): StoredCredentialRecord[] {
  const byId = new Map<string, StoredCredentialRecord>()
  for (const record of left ?? []) byId.set(record.id, record)
  for (const record of right ?? []) {
    const existing = byId.get(record.id)
    if (!existing || record.lastUsedAt >= existing.lastUsedAt) byId.set(record.id, record)
  }
  const result: StoredCredentialRecord[] = []
  for (const record of byId.values()) {
    const tomb = tombstones[record.id] ?? 0
    if (tomb > 0 && tomb >= record.addedAt) continue
    result.push(record)
  }
  return result.sort((a, b) => a.addedAt - b.addedAt)
}

/* 选择激活凭证:按 activeUpdatedAt 取较新的一侧, 失效时回退到列表最后一项 */
function pickActive(disk: StoredConfig | null, desired: StoredConfig, credentials: readonly StoredCredentialRecord[]): string | undefined {
  if (credentials.length === 0) return undefined
  const diskStamp = disk?.activeUpdatedAt ?? 0
  const desiredStamp = desired.activeUpdatedAt ?? 0
  const candidate = desiredStamp >= diskStamp ? desired.activeCredentialId : disk?.activeCredentialId
  if (candidate !== undefined && credentials.some((record) => record.id === candidate)) return candidate
  const fallback = desired.activeCredentialId ?? disk?.activeCredentialId
  if (fallback !== undefined && credentials.some((record) => record.id === fallback)) return fallback
  return credentials[credentials.length - 1].id
}

/* 合并磁盘配置与本次待写配置 */
export function mergeConfig(disk: StoredConfig | null, desired: StoredConfig): StoredConfig {
  if (!disk) return desired
  const tombstones = mergeTombstones(disk.credentialTombstones, desired.credentialTombstones)
  const credentials = mergeCredentials(disk.credentials, desired.credentials, tombstones)
  const activeCredentialId = pickActive(disk, desired, credentials)
  const activeUpdatedAt = Math.max(disk.activeUpdatedAt ?? 0, desired.activeUpdatedAt ?? 0)
  return {
    ...disk,
    ...desired,
    credentials,
    ...(activeCredentialId === undefined ? {} : { activeCredentialId }),
    ...(activeUpdatedAt === 0 ? {} : { activeUpdatedAt }),
    credentialTombstones: tombstones,
    /* settings 按变更时刻取较新的一侧, 避免一方写入凭证时覆盖另一方刚改的界面开关 */
    settings: (desired.settingsUpdatedAt ?? 0) >= (disk.settingsUpdatedAt ?? 0) ? desired.settings : disk.settings,
    settingsUpdatedAt: Math.max(disk.settingsUpdatedAt ?? 0, desired.settingsUpdatedAt ?? 0),
    ...(typeof desired.userId === 'string' && desired.userId !== '' ? { userId: desired.userId } : {}),
    ...(typeof desired.username === 'string' && desired.username !== '' ? { username: desired.username } : {}),
  }
}

/* 归一化磁盘内容:字段类型不合法时整条丢弃, 避免损坏数据污染运行状态 */
export function normalizeStoredConfig(value: unknown): StoredConfig | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const settings = typeof raw.settings === 'object' && raw.settings !== null ? raw.settings as StoredConfig['settings'] : undefined
  if (!settings) return null
  const records: StoredCredentialRecord[] = []
  for (const item of Array.isArray(raw.credentials) ? raw.credentials : []) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.secret !== 'string' || typeof record.maskedSecret !== 'string') continue
    if (record.type !== 'api_key' && record.type !== 'oauth') continue
    records.push({
      id: record.id,
      type: record.type,
      secret: record.secret,
      maskedSecret: record.maskedSecret,
      ...(typeof record.userId === 'string' ? { userId: record.userId } : {}),
      ...(typeof record.username === 'string' ? { username: record.username } : {}),
      addedAt: typeof record.addedAt === 'number' ? record.addedAt : 0,
      lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : 0,
    })
  }
  const tombstones: Record<string, number> = {}
  if (typeof raw.credentialTombstones === 'object' && raw.credentialTombstones !== null) {
    for (const [id, ts] of Object.entries(raw.credentialTombstones as Record<string, unknown>)) {
      if (typeof ts === 'number' && Number.isFinite(ts)) tombstones[id] = ts
    }
  }
  return {
    settings,
    ...(records.length === 0 ? {} : { credentials: records }),
    ...(typeof raw.activeCredentialId === 'string' ? { activeCredentialId: raw.activeCredentialId } : {}),
    ...(typeof raw.activeUpdatedAt === 'number' ? { activeUpdatedAt: raw.activeUpdatedAt } : {}),
    ...(Object.keys(tombstones).length === 0 ? {} : { credentialTombstones: tombstones }),
    ...(typeof raw.apiKey === 'string' ? { apiKey: raw.apiKey } : {}),
    ...(typeof raw.oauthToken === 'string' ? { oauthToken: raw.oauthToken } : {}),
    ...(typeof raw.userId === 'string' ? { userId: raw.userId } : {}),
    ...(typeof raw.username === 'string' ? { username: raw.username } : {}),
  }
}
