/*
 * 认证管理模块实现
 * 作者: JularDepick
 *
 * 双轨凭证: WakaTime 插件密钥(API Key, HTTP Basic)与 OAuth 访问令牌(Bearer),
 * 均存于配置文件(0600 权限), 只允许覆盖写入, 任何读取面均不回显明文;
 * 环境变量 WAKATIME_API_KEY 与 WAKATIME_OAUTH_TOKEN 分别优先于配置文件。
 * 按端点用途选轨(官方把 API Key 限定为插件写活动, 其余用途应使用 OAuth 令牌):
 * 插件写活动优先 API Key, 其他用途(账号资料与战绩读取)优先 OAuth 令牌,
 * 只配置了其中一种时两种用途都走它, 保持旧配置可用。
 * 覆盖写入时先经验证(/users/current), 验证失败不落盘。
 */

import { ANONYMOUS_DISPLAY_NAME, DEFAULT_REPORT_INTERVAL_SECONDS, ENV_API_KEY, ENV_OAUTH_TOKEN, USER_INFO_PATH } from '../constants'
import type { EndpointUsage } from '../constants'
import type { ConfigManager, StoredConfig } from '../config-manager'
import { NotAuthenticatedError } from '../errors'
import type { AuthHeader, HttpClient } from '../http'
import type { AuthManager, AuthStatus, CredentialKind, ResolvedCredential, UserProfile } from './types'

/* 插件密钥的认证值:base64(密钥 + 冒号),即 HTTP Basic 的 username=api_key 口径 */
export function basicAuthValueOf(apiKey: string): string {
  return Buffer.from(apiKey + ':').toString('base64')
}

/* OAuth 访问令牌的认证头(Bearer) */
export function bearerHeaderOf(token: string): AuthHeader {
  return { scheme: 'Bearer', value: token }
}

/* 按凭证种类构造认证头 */
export function authHeaderOf(kind: CredentialKind, secret: string): AuthHeader {
  return kind === 'oauth' ? bearerHeaderOf(secret) : { scheme: 'Basic', value: basicAuthValueOf(secret) }
}

/* 端点用途到凭证尝试顺序的映射:首选在前, 另一种兜底 */
const CREDENTIAL_ORDER: Record<EndpointUsage, CredentialKind[]> = {
  plugin_write: ['api_key', 'oauth'],
  other_use: ['oauth', 'api_key'],
}

/* 凭证种类到环境变量名的映射(环境变量优先于配置文件) */
const SECRET_ENV: Record<CredentialKind, string> = {
  api_key: ENV_API_KEY,
  oauth: ENV_OAUTH_TOKEN,
}

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
  /* 内存缓存:避免每次请求读盘;覆盖写入后同步更新 */
  private readonly secretCache: Record<CredentialKind, string | null> = { api_key: null, oauth: null }
  /* 凭证变更订阅者(切换数据桶等副作用由调用方处理) */
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly http: HttpClient,
    private readonly configManager: ConfigManager,
  ) {}

  /* 订阅凭证变更(覆盖写入或清除后触发);返回取消订阅函数 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /* 读取一种凭证:环境变量优先, 其次配置文件缓存, 最后读盘;未配置返回 null */
  private async readSecret(kind: CredentialKind): Promise<string | null> {
    const fromEnv = process.env[SECRET_ENV[kind]]
    if (fromEnv) return fromEnv
    const cached = this.secretCache[kind]
    if (cached) return cached
    const stored = await this.configManager.load()
    const secret = kind === 'oauth' ? stored?.oauthToken : stored?.apiKey
    if (!secret) return null
    this.secretCache[kind] = secret
    return secret
  }

  /* 当前生效的 API Key:未配置时抛 NotAuthenticatedError */
  async getApiKey(): Promise<string> {
    const secret = await this.readSecret('api_key')
    if (!secret) throw new NotAuthenticatedError()
    return secret
  }

  /* 当前生效的 API Key;未配置时返回 null(供分桶路由使用,不抛错) */
  async tryGetApiKey(): Promise<string | null> {
    return this.readSecret('api_key')
  }

  /* 当前生效的 OAuth 访问令牌:未配置时抛 NotAuthenticatedError */
  async getOauthToken(): Promise<string> {
    const secret = await this.readSecret('oauth')
    if (!secret) throw new NotAuthenticatedError()
    return secret
  }

  /* 当前生效的 OAuth 访问令牌;未配置时返回 null */
  async tryGetOauthToken(): Promise<string | null> {
    return this.readSecret('oauth')
  }

  /* 数据桶归属用的凭证原文:取写活动面首选(历史按 API Key 分桶的口径),
     只有令牌时取令牌;两种都未配置时返回 null(未指派桶) */
  async getCredentialSecret(): Promise<string | null> {
    return (await this.readSecret('api_key')) ?? (await this.readSecret('oauth'))
  }

  /* 按端点用途解析生效凭证:按顺序取第一个已配置的种类 */
  async getCredential(usage: EndpointUsage): Promise<ResolvedCredential> {
    for (const kind of CREDENTIAL_ORDER[usage]) {
      const secret = await this.readSecret(kind)
      if (secret) return { kind, header: authHeaderOf(kind, secret) }
    }
    throw new NotAuthenticatedError()
  }

  async setApiKey(apiKey: string): Promise<UserProfile> {
    return this.setCredential('api_key', apiKey)
  }

  async setOauthToken(token: string): Promise<UserProfile> {
    return this.setCredential('oauth', token)
  }

  async getStatus(): Promise<AuthStatus> {
    const apiKey = await this.readSecret('api_key')
    const oauthToken = await this.readSecret('oauth')
    const kinds = { apiKeyConfigured: apiKey !== null, oauthConfigured: oauthToken !== null }
    if (apiKey === null && oauthToken === null) {
      return { configured: false, ...kinds }
    }
    /* 写活动面生效种类:API Key 优先, 与 CREDENTIAL_ORDER.plugin_write 一致 */
    const kind: CredentialKind = apiKey !== null ? 'api_key' : 'oauth'
    /* 环境变量注入的凭证不落盘, 也不回写账号名(与旧版一致:只报已配置) */
    if (process.env[SECRET_ENV[kind]]) return { configured: true, ...kinds, kind }
    const stored = await this.configManager.load()
    if (!stored) return { configured: true, ...kinds, kind }
    const username = await this.resolveUsername(stored)
    return { configured: true, ...kinds, kind, ...(username === undefined ? {} : { username }) }
  }

  async clearApiKey(): Promise<void> {
    await this.clearSecrets(['api_key'])
  }

  async clearCredential(): Promise<void> {
    await this.clearSecrets(['api_key', 'oauth'])
  }

  /* 通知订阅者凭证已变更 */
  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /* 覆盖写入一种凭证:先验证有效性(验证失败不落盘), 成功后回写账号名并通知订阅者 */
  private async setCredential(kind: CredentialKind, secret: string): Promise<UserProfile> {
    const trimmed = secret.trim()
    if (!trimmed) throw new Error(kind === 'oauth' ? 'OAuth token must not be empty' : 'API key must not be empty')
    const profile = await this.fetchUserProfile(authHeaderOf(kind, trimmed))
    const stored = await this.configManager.load()
    await this.configManager.save({
      ...(stored ?? {}),
      ...(kind === 'oauth' ? { oauthToken: trimmed } : { apiKey: trimmed }),
      userId: profile.userId,
      username: profile.username,
      settings: stored?.settings ?? defaultSettings(),
    })
    this.secretCache[kind] = trimmed
    this.notify()
    return profile
  }

  /* 清除指定种类的凭证并清空缓存 */
  private async clearSecrets(kinds: CredentialKind[]): Promise<void> {
    const stored = await this.configManager.load()
    if (stored) {
      const next: StoredConfig = { ...stored }
      if (kinds.includes('api_key')) next.apiKey = undefined
      if (kinds.includes('oauth')) next.oauthToken = undefined
      await this.configManager.save(next)
    }
    for (const kind of kinds) this.secretCache[kind] = null
    this.notify()
  }

  /* 展示用账号名:缓存值可用时直接返回;缺失或仍是匿名占位时借生效凭证重新解析并回写,
     解析失败返回 undefined(不展示匿名占位,也不阻塞状态查询) */
  private async resolveUsername(stored: StoredConfig): Promise<string | undefined> {
    const current = typeof stored.username === 'string' ? stored.username.trim() : ''
    if (current && !isAnonymousPlaceholder(current)) return current
    try {
      const { header } = await this.getCredential('other_use')
      const profile = await this.fetchUserProfile(header)
      if (profile.username !== undefined && profile.username !== current) {
        await this.configManager.save({ ...stored, userId: profile.userId, username: profile.username })
      }
      return profile.username
    } catch {
      return undefined
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

export type { AuthManager, AuthStatus, CredentialKind, ResolvedCredential, UserProfile } from './types'
