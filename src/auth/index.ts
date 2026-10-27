/*
 * 认证管理模块实现
 * 作者: JularDepick
 *
 * 0.4.0 起只支持一份 OAuth 访问令牌: 官方把插件密钥限定为写入专用,
 * 而战绩读取与云端同步都需要读取权限, 故统一使用个人 OAuth 令牌.
 * 本地只保存一份凭证, 更换凭证即覆盖; 明文只存在于 host 进程与配置文件(0600),
 * 任何读取面只下发打码值.
 */

import {
  ANONYMOUS_DISPLAY_NAME,
  CLOUD_SUMMARY_RANGE,
  CONFIG_FILE_VERSION,
  DEFAULT_REPORT_INTERVAL_SECONDS,
  ENV_OAUTH_TOKEN,
  SUMMARIES_PATH,
  USER_INFO_PATH,
  USER_PROFILE_FAILURE_TTL_MS,
  USER_PROFILE_STATUS_TIMEOUT_MS,
} from '../constants'
import type { ConfigManager, StoredConfig } from '../config-manager'
import { CredentialInputError, NotAuthenticatedError } from '../errors'
import type { AuthHeader, HttpClient } from '../http'
import { WakaTimeError } from '../http'
import { detectCredentialType, maskCredential } from '../credential-format'
import { OauthCredential } from './credential'
import type { AuthManager, AuthStatus, SetCredentialResult, UserProfile } from './types'

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

/* 给异步操作加超时:超时按失败处理,避免状态查询被网络请求拖住 */
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    task,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('timeout')) }, ms)
      timer.unref?.()
    }),
  ])
}

/* 默认 settings(与 Config 默认值对齐) */
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

function emptyConfig(): StoredConfig {
  return { version: CONFIG_FILE_VERSION, settings: defaultSettings() }
}

export class AuthManagerImpl implements AuthManager {
  /* 配置内存缓存(含凭证);任何写入后同步更新 */
  private stored: StoredConfig | null = null
  /* 账号名解析失败时刻:窗口内不再外呼资料接口 */
  private profileFailureAt = 0
  private loaded = false
  /* 凭证变更订阅者(作废云端快照等副作用由调用方处理) */
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly http: HttpClient,
    private readonly configManager: ConfigManager,
  ) {}

  /* 订阅凭证变更(保存/清除后触发);返回取消订阅函数 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /* 当前凭证原文;未配置时返回 null */
  async getSecret(): Promise<string | null> {
    const fromEnv = this.envToken()
    if (fromEnv !== null) return fromEnv
    const stored = await this.config()
    return stored?.credential?.secret ?? null
  }

  /* 当前凭证的认证头;未配置时抛 NotAuthenticatedError */
  async getAuthHeader(): Promise<AuthHeader> {
    const secret = await this.getSecret()
    if (secret === null) throw new NotAuthenticatedError()
    return new OauthCredential(secret).authHeader()
  }

  /* 保存凭证:格式校验 -> 服务端验证 -> 覆盖落盘;验证失败不落盘.
     环境变量凭证优先于配置文件, 此时保存不会生效, 直接拒绝并提示移除环境变量 */
  async setCredential(input: string): Promise<SetCredentialResult> {
    if (this.hasEnvCredential()) throw new CredentialInputError('env_locked')
    const detection = detectCredentialType(input)
    if (!detection.ok) throw new CredentialInputError(detection.reason === 'unknown' ? 'unknown_format' : detection.reason)
    const credential = new OauthCredential(input.trim())
    /* 验证失败(无效凭证或网络异常)不落盘 */
    const profile = await this.validateCredential(credential)
    const stored = (await this.config()) ?? emptyConfig()
    const now = Date.now()
    const existed = stored.credential?.secret === credential.secret
    /* 换凭证时账号缓存必须整体替换: 解析不到新账号名就清空, 否则会一直显示上一个账号 */
    const { userId: _oldUserId, username: _oldUsername, ...rest } = stored
    const next: StoredConfig = {
      ...rest,
      version: CONFIG_FILE_VERSION,
      credential: { secret: credential.secret, type: 'oauth', updatedAt: now },
      credentialUpdatedAt: now,
      ...(profile.userId === undefined ? {} : { userId: profile.userId }),
      ...(profile.username === undefined ? {} : { username: profile.username }),
      accountUpdatedAt: now,
    }
    await this.setStored(next)
    return {
      maskedSecret: credential.maskedSecret,
      ...(profile.username === undefined ? {} : { username: profile.username }),
      existed,
      replaced: stored.credential !== undefined && !existed,
      updatedAt: now,
    }
  }

  /* 清除已保存凭证(本地数据保留);环境变量凭证生效时无法通过配置清除 */
  async clearCredential(): Promise<void> {
    if (this.hasEnvCredential()) throw new CredentialInputError('env_locked')
    const stored = await this.config()
    if (!stored || stored.credential === undefined) return
    const { credential: _credential, userId: _userId, username: _username, ...rest } = stored
    const now = Date.now()
    await this.setStored({ ...rest, credentialUpdatedAt: now, accountUpdatedAt: now })
  }

  /* 环境变量凭证是否生效(优先级高于配置文件) */
  hasEnvCredential(): boolean {
    return this.envToken() !== null
  }

  async getStatus(): Promise<AuthStatus> {
    const stored = await this.config()
    const fromEnv = this.envToken()
    if (fromEnv !== null) return { configured: true, fromEnv: true, maskedSecret: maskCredential(fromEnv) }
    if (!stored?.credential) return { configured: false, fromEnv: false }
    const base: AuthStatus = {
      configured: true,
      fromEnv: false,
      maskedSecret: maskCredential(stored.credential.secret),
      updatedAt: stored.credential.updatedAt,
    }
    const username = await this.resolveUsername(stored)
    return username === undefined ? base : { ...base, username }
  }

  /* 凭证有效性校验(官方把插件密钥限定为写入专用, 故这里只处理 OAuth 令牌):
     - 先试账号资料接口(官方标注需 email scope):成功即有效, 并带回账号名;
     - 被 401/403 拒绝时退战绩接口(需 read_summaries)确认, 战绩可用即视为有效;
     - 网络异常一律拒绝, 避免把拼写错误当成可用凭证 */
  private async validateCredential(credential: OauthCredential): Promise<UserProfile> {
    const header = credential.authHeader()
    try {
      return await this.fetchUserProfile(header)
    } catch (error) {
      if (!(error instanceof WakaTimeError) || (error.status !== 401 && error.status !== 403)) throw error
      /* 凭证校验是交互式路径, 只重试一次:失败要尽快把结论交回调用方, 不做长退避 */
      await this.http.request(`${SUMMARIES_PATH}?range=${CLOUD_SUMMARY_RANGE}`, {
        method: 'GET',
        auth: header,
        maxRetries: 1,
      })
      return {}
    }
  }

  /* 用认证头拉取账号资料并验证有效性:HTTP 非 2xx(如 401)或网络异常
     视为凭证无效,抛出 WakaTimeError;成功时账号名经 pickUsername 解析 */
  async fetchUserProfile(header: AuthHeader): Promise<UserProfile> {
    const data = await this.http.request<{ data?: ProfileFields }>(
      USER_INFO_PATH,
      { method: 'GET', auth: header, maxRetries: 1 },
    )
    /* 校验必须看到身份字段: 网关返回 HTML 或重定向页时 HTTP 仍是 2xx,
       不能把这种响应当成"凭证有效" */
    const user = data?.data
    if (typeof user !== 'object' || user === null) {
      throw new WakaTimeError(0, 'unexpected profile response')
    }
    const id = typeof user.id === 'string' ? user.id.trim() : ''
    const hasUsername = typeof user.username === 'string' && user.username.trim() !== ''
    const hasName = typeof user.full_name === 'string' && user.full_name.trim() !== ''
    if (id === '' && !hasUsername && !hasName) {
      throw new WakaTimeError(0, 'unexpected profile response')
    }
    return { userId: user.id, username: pickUsername(user) }
  }

  /* 读取并缓存配置;首次读取时由 config-manager 完成旧结构迁移 */
  private async config(): Promise<StoredConfig | null> {
    if (!this.loaded) {
      this.stored = await this.configManager.load()
      this.loaded = true
      return this.stored
    }
    /* 后续读取:其它 profile 进程可能刚改过配置, 按 mtime 检查并并入内存 */
    const refreshed = await this.configManager.refresh()
    if (refreshed !== null) this.stored = refreshed
    return this.stored
  }

  /* 写入配置并通知订阅者 */
  private async setStored(next: StoredConfig): Promise<void> {
    this.stored = await this.configManager.save(next)
    this.loaded = true
    for (const listener of [...this.listeners]) listener()
  }

  /* 静默写入(仅刷新账号名缓存时不触发凭证变更副作用) */
  private async saveQuietly(next: StoredConfig): Promise<void> {
    this.stored = await this.configManager.save(next)
    this.loaded = true
  }

  /* 环境变量注入的凭证(不落盘) */
  private envToken(): string | null {
    const token = process.env[ENV_OAUTH_TOKEN]?.trim()
    return token ? token : null
  }

  /* 展示用账号名:缓存值可用时直接返回;缺失或仍是匿名占位时重新解析并回写,
     解析失败返回 undefined(不展示匿名占位,也不阻塞状态查询) */
  private async resolveUsername(stored: StoredConfig): Promise<string | undefined> {
    const cached = typeof stored.username === 'string' ? stored.username.trim() : ''
    if (cached && !isAnonymousPlaceholder(cached)) return cached
    if (this.profileFailureAt > 0 && Date.now() - this.profileFailureAt < USER_PROFILE_FAILURE_TTL_MS) return undefined
    try {
      const secret = stored.credential?.secret
      if (secret === undefined) return undefined
      const profile = await withTimeout(
        this.fetchUserProfile(new OauthCredential(secret).authHeader()),
        USER_PROFILE_STATUS_TIMEOUT_MS,
      )
      if (profile.username !== undefined && profile.username !== cached) {
        await this.saveQuietly({
          ...stored,
          ...(profile.userId === undefined ? {} : { userId: profile.userId }),
          username: profile.username,
          accountUpdatedAt: Date.now(),
        })
      }
      this.profileFailureAt = 0
      return profile.username
    } catch {
      this.profileFailureAt = Date.now()
      return undefined
    }
  }
}

export type { AuthManager, AuthStatus, SetCredentialResult, UserProfile } from './types'
