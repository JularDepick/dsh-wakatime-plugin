/*
 * 认证管理模块实现
 * 作者: JularDepick
 *
 * WakaTime API Key 认证:内存缓存 + 配置文件持久化(0600 权限)。
 * Key 只允许覆盖写入,任何读取面均不回显明文;环境变量
 * WAKATIME_API_KEY 优先于配置文件。配置时先经 /users/current 验证。
 */

import { DEFAULT_REPORT_INTERVAL_SECONDS, ENV_API_KEY, USER_INFO_PATH } from '../constants'
import type { ConfigManager, StoredConfig } from '../config-manager'
import { NotAuthenticatedError } from '../errors'
import type { HttpClient } from '../http'
import type { AuthManager, AuthStatus, UserProfile } from './types'

/* API Key 的 HTTP Basic 认证值:base64(`${key}:`) */
export function basicAuthOf(apiKey: string): string {
  return Buffer.from(`${apiKey}:`).toString('base64')
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
    if (!trimmed) throw new Error('API Key 不能为空')
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
    return { configured: true, username: stored.username }
  }

  async clearApiKey(): Promise<void> {
    const stored = await this.configManager.load()
    if (stored) {
      await this.configManager.save({ ...stored, apiKey: undefined })
    }
    this.apiKeyCache = null
  }

  /* 用给定 Key 拉取用户资料并验证有效性:HTTP 非 2xx(如 401)或网络异常
     视为 Key 无效,抛出 WakaTimeError;成功时尽力解析用户名 */
  async fetchUserProfile(apiKey: string): Promise<UserProfile> {
    const data = await this.http.request<{
      data?: { id?: string; username?: string; display_name?: string; email?: string }
    }>(
      USER_INFO_PATH,
      { method: 'GET', basicAuth: basicAuthOf(apiKey), noRetry: true },
    )
    const user = data?.data
    if (!user) return {}
    return {
      userId: user.id,
      username: user.display_name || user.username || user.email || user.id,
    }
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
