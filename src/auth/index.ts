/*
 * 认证管理模块实现
 * 作者: JularDepick
 *
 * WakaTime API Key 认证:内存缓存 + 配置文件持久化(0600 权限)。
 * Key 只允许覆盖写入,任何读取面均不回显明文;环境变量
 * WAKATIME_API_KEY 优先于配置文件。配置时先经 /users/current 验证。
 */

import { ANONYMOUS_DISPLAY_NAME, DEFAULT_REPORT_INTERVAL_SECONDS, ENV_API_KEY, USER_INFO_PATH } from '../constants'
import type { ConfigManager, StoredConfig } from '../config-manager'
import { NotAuthenticatedError } from '../errors'
import type { HttpClient } from '../http'
import type { AuthManager, AuthStatus, UserProfile } from './types'

/* API Key 的 HTTP Basic 认证值:base64(`${key}:`) */
export function basicAuthOf(apiKey: string): string {
  return Buffer.from(`${apiKey}:`).toString('base64')
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
  private apiKeyCache: string | null = null

  constructor(
    private readonly http: HttpClient,
    private readonly configManager: ConfigManager,
  ) {}

  async getApiKey(): Promise<string> {
    const fromEnv = process.env[ENV_API_KEY]
    if (fromEnv) return fromEnv
    if (this.apiKeyCache) return this.apiKeyCache
    const stored = await this.configManager.load()
    if (!stored?.apiKey) throw new NotAuthenticatedError()
    this.apiKeyCache = stored.apiKey
    return stored.apiKey
  }

  async setApiKey(apiKey: string): Promise<UserProfile> {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API key must not be empty')
    /* 先验证有效性:验证失败(Key 无效或网络异常)不落盘 */
    const profile = await this.fetchUserProfile(trimmed)
    const stored = await this.configManager.load()
    await this.configManager.save({
      ...(stored ?? {}),
      apiKey: trimmed,
      userId: profile.userId,
      username: profile.username,
      settings: stored?.settings ?? defaultSettings(),
    })
    this.apiKeyCache = trimmed
    return profile
  }

  async getStatus(): Promise<AuthStatus> {
    if (process.env[ENV_API_KEY]) return { configured: true }
    const stored = await this.configManager.load()
    if (!stored?.apiKey) return { configured: false }
    const username = await this.resolveUsername(stored, stored.apiKey)
    return { configured: true, ...(username === undefined ? {} : { username }) }
  }

  async clearApiKey(): Promise<void> {
    const stored = await this.configManager.load()
    if (stored) {
      await this.configManager.save({ ...stored, apiKey: undefined })
    }
    this.apiKeyCache = null
  }

  /* 展示用账号名:缓存值可用时直接返回;缺失或仍是匿名占位时借已存 Key 重新解析并回写,
     解析失败返回 undefined(不展示匿名占位,也不阻塞状态查询) */
  private async resolveUsername(stored: StoredConfig, apiKey: string): Promise<string | undefined> {
    const current = typeof stored.username === 'string' ? stored.username.trim() : ''
    if (current && !isAnonymousPlaceholder(current)) return current
    try {
      const profile = await this.fetchUserProfile(apiKey)
      if (profile.username !== undefined && profile.username !== current) {
        await this.configManager.save({ ...stored, userId: profile.userId, username: profile.username })
      }
      return profile.username
    } catch {
      return undefined
    }
  }

  /* 用给定 Key 拉取用户资料并验证有效性:HTTP 非 2xx(如 401)或网络异常
     视为 Key 无效,抛出 WakaTimeError;成功时账号名经 pickUsername 解析
     (官方 username 与 full_name 可为 null,display_name 的匿名占位需剔除) */
  async fetchUserProfile(apiKey: string): Promise<UserProfile> {
    const data = await this.http.request<{ data?: ProfileFields }>(
      USER_INFO_PATH,
      { method: 'GET', basicAuth: basicAuthOf(apiKey), noRetry: true },
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

export type { AuthManager, AuthStatus, UserProfile } from './types'
