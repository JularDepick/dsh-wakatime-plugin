/*
 * 认证管理模块实现
 * 作者: JularDepick
 *
 * 凭证模型: 插件密钥(HTTP Basic)与 OAuth 访问令牌(Bearer)同权, 用同一基类描述,
 * 类型由前缀自动识别(见 src/credential-format.ts), 调用方无需选择类型.
 * 本地维护一份凭证列表与一个激活凭证: 上报与读取统一使用激活凭证的认证头,
 * 每个凭证按标识对应一个数据桶(缓存), 切换凭证即切换缓存与展示.
 * 明文只存在于 host 进程与配置文件(0600), 任何读取面只下发打码值.
 * 旧版单字段配置(apiKey / oauthToken)在首次读取时迁移为凭证列表, 原桶身份不变.
 */

import {
  ANONYMOUS_DISPLAY_NAME,
  CLOUD_SUMMARY_RANGE,
  DEFAULT_REPORT_INTERVAL_SECONDS,
  ENV_API_KEY,
  ENV_OAUTH_TOKEN,
  SUMMARIES_PATH,
  USER_INFO_PATH,
  USER_PROFILE_FAILURE_TTL_MS,
} from '../constants'
import type { ConfigManager, StoredConfig, StoredCredentialRecord } from '../config-manager'
import { CredentialInputError, NotAuthenticatedError } from '../errors'
import type { AuthHeader, HttpClient } from '../http'
import { WakaTimeError } from '../http'
import { detectCredentialType, maskCredential } from '../credential-format'
import { CredentialBase, credentialIdOf, credentialOf } from './credential'
import type { AddCredentialResult, AuthManager, AuthStatus, CredentialSummary, UserProfile } from './types'

/* /users/current 响应中用于解析账号名的字段(官方 username 与 full_name 均可为 null) */
export interface ProfileFields {
  id?: string
  username?: string | null
  display_name?: string | null
  full_name?: string | null
  email?: string | null
}

/* 是否为匿名占位显示名(服务端在未设置用户名与姓名时返回的固定值) */
function isAnonymousPlaceholder(value: string): boolean {
  return value.toLowerCase() === ANONYMOUS_DISPLAY_NAME.toLowerCase()
}

/* 解析展示用账号名:依次取 username、full_name、display_name、email、id,
   跳过空值与匿名占位;全部不可用时返回 undefined(界面只显示已配置状态) */
export function pickUsername(user: ProfileFields): string | undefined {
  const candidates = [user.username, user.full_name, user.display_name, user.email, user.id]
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (!value || isAnonymousPlaceholder(value)) continue
    return value
  }
  return undefined
}

export class AuthManagerImpl implements AuthManager {
  /* 配置内存缓存(含凭证列表);任何写入后同步更新 */
  private stored: StoredConfig | null = null
  /* 账号名解析失败时刻(按凭证标识):窗口内不再外呼资料接口 */
  private readonly profileFailures = new Map<string, number>()
  private loaded = false
  /* 凭证变更订阅者(切换数据桶等副作用由调用方处理) */
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly http: HttpClient,
    private readonly configManager: ConfigManager,
  ) {}

  /* 订阅凭证变更(添加/切换/移除/清除后触发);返回取消订阅函数 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /* 全部已存凭证摘要;当前激活项置 active(环境变量注入项不在列表内) */
  async listCredentials(): Promise<CredentialSummary[]> {
    const stored = await this.config()
    const activeId = this.activeRecord(stored)?.id
    return (stored?.credentials ?? []).map((record) => this.summarize(record, record.id === activeId))
  }

  /* 当前激活凭证原文(数据桶归属用);未配置时返回 null */
  async getActiveSecret(): Promise<string | null> {
    const fromEnv = this.envCredential()
    if (fromEnv) return fromEnv.secret
    const stored = await this.config()
    return this.activeRecord(stored)?.secret ?? null
  }

  /* 当前激活凭证的认证头;未配置时抛 NotAuthenticatedError */
  /* 当前激活凭证对应的账号标识(仅用于云端快照按账号去重;环境变量凭证无此值) */
  async getActiveUserId(): Promise<string | null> {
    if (this.envCredential() !== null) return null
    const stored = await this.config()
    const record = this.activeRecord(stored)
    if (!record) return null
    const fromRecord = typeof record.userId === 'string' ? record.userId.trim() : ''
    if (fromRecord !== '') return fromRecord
    const fromConfig = typeof stored?.userId === 'string' ? stored.userId.trim() : ''
    return fromConfig === '' ? null : fromConfig
  }

  async getAuthHeader(): Promise<AuthHeader> {
    const fromEnv = this.envCredential()
    if (fromEnv) return fromEnv.authHeader()
    const stored = await this.config()
    const record = this.activeRecord(stored)
    if (!record) throw new NotAuthenticatedError()
    return credentialOf(record.type, record.secret).authHeader()
  }

  /* 添加凭证: 自动识别类型 -> 服务端验证 -> 落盘并设为激活;已存在时只切换并刷新信息 */
  async addCredential(input: string): Promise<AddCredentialResult> {
    const detection = detectCredentialType(input)
    if (!detection.ok) throw new CredentialInputError(detection.reason === 'unknown' ? 'unknown_format' : detection.reason)
    const credential = credentialOf(detection.type, input)
    /* 验证失败(无效凭证或网络异常)不落盘;校验策略按类型区分, 见 validateCredential */
    const profile = await this.validateCredential(credential)
    const stored = (await this.config()) ?? emptyConfig()
    const records = [...(stored.credentials ?? [])]
    const index = records.findIndex((record) => record.id === credential.id)
    const now = Date.now()
    const record: StoredCredentialRecord = {
      id: credential.id,
      type: credential.type,
      secret: credential.secret,
      maskedSecret: credential.maskedSecret,
      ...(profile.userId === undefined ? {} : { userId: profile.userId }),
      ...(profile.username === undefined ? {} : { username: profile.username }),
      addedAt: index >= 0 ? records[index].addedAt : now,
      lastUsedAt: now,
    }
    if (index >= 0) records[index] = record
    else records.push(record)
    await this.setStored({
      ...stored,
      credentials: records,
      activeCredentialId: record.id,
      activeUpdatedAt: now,
      settings: stored.settings ?? defaultSettings(),
      ...(profile.userId === undefined ? {} : { userId: profile.userId }),
      ...(profile.username === undefined ? {} : { username: profile.username }),
    })
    return { summary: this.summarize(record, true), profile, existed: index >= 0 }
  }

  /* 切换激活凭证: 只改选中项与最近使用时刻 */
  async switchCredential(id: string): Promise<CredentialSummary> {
    const stored = await this.config()
    const records = [...(stored?.credentials ?? [])]
    const index = records.findIndex((record) => record.id === id)
    if (!stored || index < 0) throw new CredentialInputError('not_found')
    const record: StoredCredentialRecord = { ...records[index], lastUsedAt: Date.now() }
    records[index] = record
    await this.setStored({ ...stored, credentials: records, activeCredentialId: id, activeUpdatedAt: Date.now() })
    return this.summarize(record, true)
  }

  /* 移除凭证: 当前激活项不可移除(需先切换), 移除后其本地缓存仍保留在缓存清单里 */
  async removeCredential(id: string): Promise<void> {
    const stored = await this.config()
    const records = [...(stored?.credentials ?? [])]
    const index = records.findIndex((record) => record.id === id)
    if (!stored || index < 0) throw new CredentialInputError('not_found')
    if (this.activeRecord(stored)?.id === id) throw new CredentialInputError('active')
    records.splice(index, 1)
    /* 记墓碑:其它进程合并时不会把这条凭证复活 */
    const tombstones = { ...(stored.credentialTombstones ?? {}), [id]: Date.now() }
    await this.setStored({ ...stored, credentials: records, credentialTombstones: tombstones })
  }

  /* 清除全部已存凭证(本地数据桶保留, 可在缓存清单里逐个移除) */
  async clearCredentials(): Promise<void> {
    const stored = await this.config()
    if (!stored) return
    /* 为每条已存凭证记墓碑, 否则其它进程合并时会把它们带回 */
    const now = Date.now()
    const tombstones = { ...(stored.credentialTombstones ?? {}) }
    for (const record of stored.credentials ?? []) tombstones[record.id] = now
    await this.setStored({
      ...stored,
      credentials: [],
      activeCredentialId: undefined,
      activeUpdatedAt: now,
      credentialTombstones: tombstones,
    })
  }

  async getStatus(): Promise<AuthStatus> {
    const stored = await this.config()
    const count = (stored?.credentials ?? []).length
    const fromEnv = this.envCredential()
    const record = fromEnv === null ? this.activeRecord(stored) : null
    const active: CredentialBase | null = fromEnv ?? (record === null ? null : credentialOf(record.type, record.secret))
    if (!active) return { configured: false, count, fromEnv: false }
    const base: AuthStatus = {
      configured: true,
      count,
      activeType: active.type,
      activeMaskedSecret: active.maskedSecret,
      fromEnv: fromEnv !== null,
    }
    /* 环境变量注入的凭证不落盘, 也不回写账号名(与旧版一致:只报已配置) */
    if (fromEnv !== null || stored === null || record === null) return base
    const username = await this.resolveUsername(stored, record)
    return username === undefined ? base : { ...base, username }
  }

  /* 按凭证类型校验有效性(官方把插件密钥限定为写入专用, 令牌的读取权限取决于 scope):
     - 先试账号资料接口(官方标注需 email scope):成功即有效, 并带回账号名;
     - 被 401/403 拒绝时:令牌再退战绩接口(需 read_summaries)确认, 战绩可用即视为有效(账号名未知);
       插件密钥按写入专用处理, 视为无法做读取校验而接受(账号名未知);
     - 网络异常一律拒绝, 避免把拼写错误当成可用凭证 */
  private async validateCredential(credential: CredentialBase): Promise<UserProfile> {
    const header = credential.authHeader()
    try {
      return await this.fetchUserProfile(header)
    } catch (error) {
      if (!(error instanceof WakaTimeError) || (error.status !== 401 && error.status !== 403)) throw error
      if (credential.type === 'oauth') {
        await this.http.request(`${SUMMARIES_PATH}?range=${CLOUD_SUMMARY_RANGE}`, { method: 'GET', auth: header, noRetry: true })
        return {}
      }
      return {}
    }
  }

  /* 用认证头拉取账号资料并验证有效性:HTTP 非 2xx(如 401)或网络异常
     视为凭证无效,抛出 WakaTimeError;成功时账号名经 pickUsername 解析
     (官方 username 与 full_name 可为 null,display_name 的匿名占位需剔除) */
  async fetchUserProfile(header: AuthHeader): Promise<UserProfile> {
    const data = await this.http.request<{ data?: ProfileFields }>(
      USER_INFO_PATH,
      { method: 'GET', auth: header, noRetry: true },
    )
    const user = data?.data
    if (!user) return {}
    return { userId: user.id, username: pickUsername(user) }
  }

  /* 读取并缓存配置;首次读取时把旧版单字段凭证迁移为凭证列表 */
  private async config(): Promise<StoredConfig | null> {
    /* 首次读取:走完整载入与旧版单字段迁移(迁移本身会落盘) */
    if (!this.loaded) {
      const loaded = await this.configManager.load()
      const migrated = await this.migrateLegacy(loaded)
      this.stored = migrated
      this.loaded = true
      return migrated
    }
    /* 后续读取:其它 profile 进程可能刚改过配置, 按 mtime 检查并并入内存 */
    const refreshed = await this.configManager.refresh()
    if (refreshed !== null) this.stored = refreshed
    return this.stored
  }

  /* 写入配置并通知订阅者 */
  private async setStored(next: StoredConfig): Promise<void> {
    /* save 会持锁与磁盘内容合并, 返回值才是最终生效的配置 */
    this.stored = await this.configManager.save(next)
    this.loaded = true
    this.notify()
  }

  /* 静默写入(仅刷新缓存字段时不触发数据桶切换) */
  private async saveQuietly(next: StoredConfig): Promise<void> {
    this.stored = await this.configManager.save(next)
    this.loaded = true
  }

  /* 通知订阅者凭证已变更 */
  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /* 旧版单字段(apiKey / oauthToken)迁移为凭证列表: 类型按前缀识别,
     标识与旧桶一致(凭证原文摘要), 故迁移后历史战绩不丢 */
  private async migrateLegacy(stored: StoredConfig | null): Promise<StoredConfig | null> {
    if (!stored) return stored
    const legacy = [stored.apiKey, stored.oauthToken].filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    if (legacy.length === 0) return stored
    const records = [...(stored.credentials ?? [])]
    const now = Date.now()
    for (const secret of legacy) {
      const detection = detectCredentialType(secret)
      const record: StoredCredentialRecord = {
        id: credentialIdOf(secret),
        type: detection.ok ? detection.type : 'api_key',
        secret: secret.trim(),
        maskedSecret: maskCredential(secret),
        ...(typeof stored.userId === 'string' ? { userId: stored.userId } : {}),
        ...(typeof stored.username === 'string' ? { username: stored.username } : {}),
        addedAt: now,
        lastUsedAt: now,
      }
      const index = records.findIndex((item) => item.id === record.id)
      if (index >= 0) records[index] = record
      else records.push(record)
    }
    const migrated: StoredConfig = { ...stored, credentials: records }
    migrated.activeCredentialId = stored.activeCredentialId ?? records[records.length - 1]?.id
    migrated.activeUpdatedAt = now
    migrated.apiKey = undefined
    migrated.oauthToken = undefined
    await this.saveQuietly(migrated)
    return migrated
  }

  /* 环境变量注入的凭证:OAuth 令牌优先于插件密钥, 均不落盘 */
  private envCredential(): CredentialBase | null {
    const token = process.env[ENV_OAUTH_TOKEN]?.trim()
    if (token) return credentialOf('oauth', token)
    const apiKey = process.env[ENV_API_KEY]?.trim()
    if (apiKey) return credentialOf('api_key', apiKey)
    return null
  }

  /* 当前激活的凭证记录:未指定激活项时回退到列表最后一项 */
  private activeRecord(stored: StoredConfig | null): StoredCredentialRecord | null {
    const records = stored?.credentials ?? []
    if (records.length === 0) return null
    const activeId = stored?.activeCredentialId
    return records.find((record) => record.id === activeId) ?? records[records.length - 1]
  }

  /* 摘要化凭证(不含明文) */
  private summarize(record: StoredCredentialRecord, active: boolean): CredentialSummary {
    return {
      id: record.id,
      type: record.type,
      maskedSecret: record.maskedSecret,
      ...(record.userId === undefined ? {} : { userId: record.userId }),
      ...(record.username === undefined ? {} : { username: record.username }),
      active,
      addedAt: record.addedAt,
      lastUsedAt: record.lastUsedAt,
    }
  }

  /* 展示用账号名:缓存值可用时直接返回;缺失或仍是匿名占位时借该凭证重新解析并回写,
     解析失败返回 undefined(不展示匿名占位,也不阻塞状态查询) */
  private async resolveUsername(stored: StoredConfig, record: StoredCredentialRecord): Promise<string | undefined> {
    const cached = typeof record.username === 'string' ? record.username.trim() : ''
    if (cached && !isAnonymousPlaceholder(cached)) return cached
    /* 插件密钥按官方写专用处理, 不请求账号资料接口(必然 401) */
    if (record.type === 'api_key') return undefined
    /* 失败负缓存:窗口内不重复外呼, 避免离线时每次状态查询都阻塞到请求超时 */
    const failedAt = this.profileFailures.get(record.id) ?? 0
    if (failedAt > 0 && Date.now() - failedAt < USER_PROFILE_FAILURE_TTL_MS) return undefined
    try {
      const profile = await this.fetchUserProfile(credentialOf(record.type, record.secret).authHeader())
      if (profile.username !== undefined && profile.username !== cached) {
        const records = (stored.credentials ?? []).map((item) => item.id === record.id
          ? {
              ...item,
              ...(profile.userId === undefined ? {} : { userId: profile.userId }),
              ...(profile.username === undefined ? {} : { username: profile.username }),
            }
          : item)
        await this.saveQuietly({
          ...stored,
          credentials: records,
          ...(profile.userId === undefined ? {} : { userId: profile.userId }),
          ...(profile.username === undefined ? {} : { username: profile.username }),
        })
      }
      this.profileFailures.delete(record.id)
      return profile.username
    } catch {
      this.profileFailures.set(record.id, Date.now())
      return undefined
    }
  }
}

/* 空配置(首次添加凭证时使用) */
function emptyConfig(): StoredConfig {
  return { settings: defaultSettings() }
}

/* settings 缺省块(与 Config 默认值对齐) */
function defaultSettings(): StoredConfig['settings'] {
  return {
    enabled: true,
    reportInterval: DEFAULT_REPORT_INTERVAL_SECONDS,
    reportEnabled: true,
    includeTokens: true,
    includePrompts: true,
    debug: false,
  }
}

export type { AuthManager, AuthStatus, CredentialSummary, CredentialType, UserProfile } from './types'
export type { AddCredentialResult } from './types'
