/*
 * 配置文件的跨进程合并
 * 作者: JularDepick
 *
 * 双槽模型下合并规则(逐槽独立, 避免一个槽的变更吞掉另一个槽的更新):
 * - 写入槽 / 读取槽: 各按自己的 updatedAt 取较新的一侧(清除也算一次变更);
 * - settings: 按 settingsUpdatedAt 取较新的一侧;
 * - 账号名缓存: 按 accountUpdatedAt 取较新的一侧;
 * - 同账号取证结论: 按 checkedAt 取较新的一侧(是否仍有效由读取面按槽位时间戳判定).
 * 归一化只接受当前结构版本, 旧结构交给 migrate 模块处理.
 */

import { CONFIG_FILE_VERSION, REPORT_INTERVAL_MAX_SECONDS, SUPPORTED_LANGUAGES } from '../constants'
import type { StoredConfig, StoredCredentialSlot, StoredSameAccount, StoredSettings } from './types'

/* 数值字段尽力归一: 非有限或负数按缺省处理 */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/* 凭证槽归一化: 只接受与槽位匹配的类型, 密钥非空 */
function normalizeSlot(value: unknown, type: StoredCredentialSlot['type']): StoredCredentialSlot | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.secret !== 'string' || raw.secret.trim() === '') return undefined
  if (raw.type !== type) return undefined
  return { secret: raw.secret.trim(), type, updatedAt: numberOr(raw.updatedAt, 0) }
}

/* 同账号取证结论归一化: 三个时间戳都必须有效 */
function normalizeSameAccount(value: unknown): StoredSameAccount | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (raw.verdict !== 'same' && raw.verdict !== 'different' && raw.verdict !== 'unknown') return undefined
  return {
    verdict: raw.verdict,
    writeUpdatedAt: numberOr(raw.writeUpdatedAt, 0),
    readUpdatedAt: numberOr(raw.readUpdatedAt, 0),
    checkedAt: numberOr(raw.checkedAt, 0),
  }
}

/* settings 归一化: 缺失项保持缺省(由运行期配置回退), 类型不符则丢弃该键 */
export function normalizeSettings(value: unknown): StoredSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const settings: Partial<StoredSettings> = {}
  if (typeof raw.enabled === 'boolean') settings.enabled = raw.enabled
  if (typeof raw.reportEnabled === 'boolean') settings.reportEnabled = raw.reportEnabled
  if (typeof raw.includeTokens === 'boolean') settings.includeTokens = raw.includeTokens
  if (typeof raw.includePrompts === 'boolean') settings.includePrompts = raw.includePrompts
  if (typeof raw.debug === 'boolean') settings.debug = raw.debug
  if (typeof raw.tableBorders === 'boolean') settings.tableBorders = raw.tableBorders
  if (typeof raw.reportInterval === 'number' && Number.isFinite(raw.reportInterval)
    && raw.reportInterval >= 1 && raw.reportInterval <= REPORT_INTERVAL_MAX_SECONDS) {
    settings.reportInterval = raw.reportInterval
  }
  if (raw.digitGrouping === 'thousand' || raw.digitGrouping === 'myriad') settings.digitGrouping = raw.digitGrouping
  /* 语言只接受白名单值: 非法值会让翻译加载失败并静默回退中文, 与界面显示的配置不一致 */
  if (typeof raw.locale === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(raw.locale)) {
    settings.locale = raw.locale
  }
  return settings as StoredSettings
}

/* 当前结构版本归一化: 版本不符返回 null(交给迁移或按未配置处理);
   settings 缺失或损坏不丢弃凭证, 用默认值兜底 */
export function normalizeStoredConfig(value: unknown): StoredConfig | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== CONFIG_FILE_VERSION) return null
  /* settings 缺失或损坏时按空块处理而不是补默认值: 补默认值等于替用户做了"界面写入",
     会把 cordis.yml 里显式配置的同名项盖掉. 凭证比界面设置更重要, 设置块异常不丢凭证 */
  const settings = normalizeSettings(raw.settings) ?? {}
  const write = normalizeSlot(raw.writeCredential, 'api_key')
  const read = normalizeSlot(raw.readCredential, 'oauth')
  const sameAccount = normalizeSameAccount(raw.sameAccount)
  return {
    version: CONFIG_FILE_VERSION,
    settings,
    ...(write === undefined ? {} : { writeCredential: write }),
    ...(read === undefined ? {} : { readCredential: read }),
    ...(typeof raw.writeCredentialUpdatedAt === 'number' ? { writeCredentialUpdatedAt: numberOr(raw.writeCredentialUpdatedAt, 0) } : {}),
    ...(typeof raw.readCredentialUpdatedAt === 'number' ? { readCredentialUpdatedAt: numberOr(raw.readCredentialUpdatedAt, 0) } : {}),
    ...(typeof raw.settingsUpdatedAt === 'number' ? { settingsUpdatedAt: numberOr(raw.settingsUpdatedAt, 0) } : {}),
    ...(typeof raw.userId === 'string' && raw.userId !== '' ? { userId: raw.userId } : {}),
    ...(typeof raw.username === 'string' && raw.username !== '' ? { username: raw.username } : {}),
    ...(typeof raw.accountUpdatedAt === 'number' ? { accountUpdatedAt: numberOr(raw.accountUpdatedAt, 0) } : {}),
    ...(raw.writeScope === 'ok' || raw.writeScope === 'missing' || raw.writeScope === 'unknown'
      ? { writeScope: raw.writeScope }
      : {}),
    ...(sameAccount === undefined ? {} : { sameAccount }),
  }
}

/* 按变更时刻取舍: 较新的一侧胜出(相等时取本次写入方) */
function laterThan(desiredStamp: number, diskStamp: number): boolean {
  return desiredStamp >= diskStamp
}

/* 合并磁盘配置与本次待写配置 */
export function mergeConfig(disk: StoredConfig | null, desired: StoredConfig): StoredConfig {
  if (!disk) return desired
  /* 逐槽取舍: 两个槽的变更互不影响, 一次保存只推进被改那一个槽的时间戳 */
  const writeStamp = Math.max(disk.writeCredentialUpdatedAt ?? 0, desired.writeCredentialUpdatedAt ?? 0)
  const useDesiredWrite = laterThan(desired.writeCredentialUpdatedAt ?? 0, disk.writeCredentialUpdatedAt ?? 0)
  const writeCredential = useDesiredWrite ? desired.writeCredential : disk.writeCredential
  /* 写权限属于写入槽凭证自身的属性, 跟随该槽的新旧 */
  const writeScope = useDesiredWrite ? desired.writeScope : disk.writeScope
  const readStamp = Math.max(disk.readCredentialUpdatedAt ?? 0, desired.readCredentialUpdatedAt ?? 0)
  const useDesiredRead = laterThan(desired.readCredentialUpdatedAt ?? 0, disk.readCredentialUpdatedAt ?? 0)
  const readCredential = useDesiredRead ? desired.readCredential : disk.readCredential
  /* 取证结论按取证时刻取较新的一侧; 它与两槽是否一致由读取面按时间戳判定 */
  const desiredSame = desired.sameAccount
  const diskSame = disk.sameAccount
  const sameAccount = desiredSame === undefined
    ? diskSame
    : diskSame === undefined
      ? desiredSame
      : (desiredSame.checkedAt >= diskSame.checkedAt ? desiredSame : diskSame)
  const settings = laterThan(desired.settingsUpdatedAt ?? 0, disk.settingsUpdatedAt ?? 0) ? desired.settings : disk.settings
  const useDesiredAccount = laterThan(desired.accountUpdatedAt ?? 0, disk.accountUpdatedAt ?? 0)
  const account = useDesiredAccount ? desired : disk
  return {
    version: CONFIG_FILE_VERSION,
    settings,
    ...(writeCredential === undefined ? {} : { writeCredential }),
    ...(readCredential === undefined ? {} : { readCredential }),
    writeCredentialUpdatedAt: writeStamp,
    readCredentialUpdatedAt: readStamp,
    settingsUpdatedAt: Math.max(disk.settingsUpdatedAt ?? 0, desired.settingsUpdatedAt ?? 0),
    ...(account.userId === undefined ? {} : { userId: account.userId }),
    ...(account.username === undefined ? {} : { username: account.username }),
    ...(writeScope === undefined ? {} : { writeScope }),
    ...(sameAccount === undefined ? {} : { sameAccount }),
    accountUpdatedAt: Math.max(disk.accountUpdatedAt ?? 0, desired.accountUpdatedAt ?? 0),
  }
}
