/*
 * 配置文件的跨进程合并
 * 作者: JularDepick
 *
 * 单凭证模型下合并规则:
 * - 凭证: 按 credentialUpdatedAt 取较新的一侧(清除也算一次变更);
 * - settings: 按 settingsUpdatedAt 取较新的一侧;
 * - 账号名缓存: 按 accountUpdatedAt 取较新的一侧.
 * 归一化只接受当前结构版本, 旧结构交给 migrate 模块处理.
 */

import { CONFIG_FILE_VERSION, DEFAULT_REPORT_INTERVAL_SECONDS } from '../constants'
import type { StoredConfig, StoredCredential, StoredSettings } from './types'

/* 数值字段尽力归一: 非有限或负数按缺省处理 */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/* 凭证归一化: 只接受 OAuth 令牌(secret 非空) */
function normalizeCredential(value: unknown): StoredCredential | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.secret !== 'string' || raw.secret.trim() === '') return undefined
  if (raw.type !== 'oauth') return undefined
  return { secret: raw.secret.trim(), type: 'oauth', updatedAt: numberOr(raw.updatedAt, 0) }
}

/* settings 归一化: 缺失项保持缺省(由运行期配置回退), 类型不符则丢弃该键 */
function normalizeSettings(value: unknown): StoredSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const settings: Partial<StoredSettings> = {}
  if (typeof raw.enabled === 'boolean') settings.enabled = raw.enabled
  if (typeof raw.reportEnabled === 'boolean') settings.reportEnabled = raw.reportEnabled
  if (typeof raw.includeTokens === 'boolean') settings.includeTokens = raw.includeTokens
  if (typeof raw.includePrompts === 'boolean') settings.includePrompts = raw.includePrompts
  if (typeof raw.debug === 'boolean') settings.debug = raw.debug
  if (typeof raw.tableBorders === 'boolean') settings.tableBorders = raw.tableBorders
  if (typeof raw.reportInterval === 'number' && Number.isFinite(raw.reportInterval) && raw.reportInterval >= 1) {
    settings.reportInterval = raw.reportInterval
  }
  if (raw.digitGrouping === 'thousand' || raw.digitGrouping === 'myriad') settings.digitGrouping = raw.digitGrouping
  if (typeof raw.locale === 'string' && raw.locale.trim() !== '') settings.locale = raw.locale
  return settings as StoredSettings
}

/* 当前结构版本归一化: 版本不符或 settings 缺失时返回 null(交给迁移或按未配置处理) */
export function normalizeStoredConfig(value: unknown): StoredConfig | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== CONFIG_FILE_VERSION) return null
  /* settings 缺失或损坏时用默认值兜底: 凭证比界面设置更重要, 不能因设置块异常而丢凭证 */
  const settings = normalizeSettings(raw.settings) ?? {
    enabled: true,
    reportInterval: DEFAULT_REPORT_INTERVAL_SECONDS,
    reportEnabled: true,
    includeTokens: true,
    includePrompts: true,
    debug: false,
  }
  const credential = normalizeCredential(raw.credential)
  return {
    version: CONFIG_FILE_VERSION,
    settings,
    ...(credential === undefined ? {} : { credential }),
    ...(typeof raw.credentialUpdatedAt === 'number' ? { credentialUpdatedAt: numberOr(raw.credentialUpdatedAt, 0) } : {}),
    ...(typeof raw.settingsUpdatedAt === 'number' ? { settingsUpdatedAt: numberOr(raw.settingsUpdatedAt, 0) } : {}),
    ...(typeof raw.userId === 'string' && raw.userId !== '' ? { userId: raw.userId } : {}),
    ...(typeof raw.username === 'string' && raw.username !== '' ? { username: raw.username } : {}),
    ...(typeof raw.accountUpdatedAt === 'number' ? { accountUpdatedAt: numberOr(raw.accountUpdatedAt, 0) } : {}),
  }
}

/* 按变更时刻取舍: 较新的一侧胜出(相等时取本次写入方) */
function laterThan(desiredStamp: number, diskStamp: number): boolean {
  return desiredStamp >= diskStamp
}

/* 合并磁盘配置与本次待写配置 */
export function mergeConfig(disk: StoredConfig | null, desired: StoredConfig): StoredConfig {
  if (!disk) return desired
  const credentialStamp = Math.max(disk.credentialUpdatedAt ?? 0, desired.credentialUpdatedAt ?? 0)
  const credential = laterThan(desired.credentialUpdatedAt ?? 0, disk.credentialUpdatedAt ?? 0)
    ? desired.credential
    : disk.credential
  const settings = laterThan(desired.settingsUpdatedAt ?? 0, disk.settingsUpdatedAt ?? 0) ? desired.settings : disk.settings
  const useDesiredAccount = laterThan(desired.accountUpdatedAt ?? 0, disk.accountUpdatedAt ?? 0)
  const account = useDesiredAccount ? desired : disk
  return {
    version: CONFIG_FILE_VERSION,
    settings,
    ...(credential === undefined ? {} : { credential }),
    credentialUpdatedAt: credentialStamp,
    settingsUpdatedAt: Math.max(disk.settingsUpdatedAt ?? 0, desired.settingsUpdatedAt ?? 0),
    ...(account.userId === undefined ? {} : { userId: account.userId }),
    ...(account.username === undefined ? {} : { username: account.username }),
    accountUpdatedAt: Math.max(disk.accountUpdatedAt ?? 0, desired.accountUpdatedAt ?? 0),
  }
}
