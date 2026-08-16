/*
 * 认证管理模块实现
 * 作者: JularDepick
 *
 * ensureValidToken 在令牌临近过期时经刷新令牌自动续期并持久化;
 * 刷新失败抛出 TokenRefreshError,由上层提示重新登录。
 */

import { ENV_CLIENT_ID, ENV_CLIENT_SECRET, TOKEN_REFRESH_THRESHOLD_SECONDS, USER_INFO_PATH } from '../constants'
import type { ConfigManager } from '../config-manager'
import { NotAuthenticatedError, TokenRefreshError } from '../errors'
import type { HttpClient } from '../http'
import type { OAuthCredentials, OAuthService, TokenPair } from '../oauth'
import type { RuntimeConfig } from '../runtime-config'
import type { AuthManager, AuthStatus, UserProfile } from './types'

export class AuthManagerImpl implements AuthManager {
  private readonly oauth: OAuthService
  private readonly http: HttpClient
  private readonly configManager: ConfigManager
  /* 运行时配置:clientId/clientSecret 的兜底来源(可被 Web 覆盖) */
  private readonly runtimeConfig: RuntimeConfig

  constructor(
    oauth: OAuthService,
    http: HttpClient,
    configManager: ConfigManager,
    runtimeConfig: RuntimeConfig,
  ) {
    this.oauth = oauth
    this.http = http
    this.configManager = configManager
    this.runtimeConfig = runtimeConfig
  }

  getCredentials(): OAuthCredentials {
    /* 环境变量优先,运行时配置(cordis 配置 + Web 覆盖)兜底 */
    const config = this.runtimeConfig.get()
    return {
      clientId: process.env[ENV_CLIENT_ID] || config.clientId,
      clientSecret: process.env[ENV_CLIENT_SECRET] || config.clientSecret,
    }
  }

  async ensureValidToken(): Promise<string> {
    const stored = await this.configManager.load()
    if (!stored?.accessToken) throw new NotAuthenticatedError()

    const nowSeconds = Math.floor(Date.now() / 1000)
    const expiresAt = stored.expiresAt ?? nowSeconds + 1
    /* 未到期:直接使用 */
    if (nowSeconds < expiresAt - TOKEN_REFRESH_THRESHOLD_SECONDS) {
      return stored.accessToken
    }

    /* 到期或临近:经刷新令牌续期 */
    if (!stored.refreshToken) {
      throw new TokenRefreshError('缺少刷新令牌,请重新登录')
    }
    try {
      const pair = await this.oauth.refresh(this.getCredentials(), stored.refreshToken)
      await this.saveToken(pair)
      return pair.accessToken
    } catch (error) {
      throw new TokenRefreshError((error as Error).message)
    }
  }

  async saveToken(pair: TokenPair, profile?: UserProfile): Promise<void> {
    const existing = await this.configManager.load()
    await this.configManager.save({
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresAt: pair.expiresAt,
      clientId: existing?.clientId,
      userId: profile?.userId ?? existing?.userId,
      username: profile?.username ?? existing?.username,
      settings: existing?.settings ?? {
        enabled: true,
        heartbeatInterval: 120,
        projectDetection: 'auto',
        includeTokens: true,
        includePrompts: true,
        debug: false,
      },
    })
  }

  async getStatus(): Promise<AuthStatus> {
    const stored = await this.configManager.load()
    if (!stored?.accessToken) return { authenticated: false }
    return {
      authenticated: true,
      username: stored.username,
      userId: stored.userId,
      expiresAt: stored.expiresAt,
    }
  }

  async logout(): Promise<void> {
    const stored = await this.configManager.load()
    if (stored?.accessToken) {
      try {
        await this.oauth.revoke(this.getCredentials(), stored.accessToken)
      } catch {
        /* 撤销失败不阻断本地清除 */
      }
    }
    await this.configManager.clear()
  }

  /* 拉取当前用户信息(登录成功后回填 userId/username) */
  async fetchUserProfile(token: string): Promise<{ userId?: string; username?: string }> {
    try {
      const data = await this.http.request<{ data?: { id?: string; username?: string; display_name?: string } }>(
        USER_INFO_PATH,
        { method: 'GET', bearer: token, noRetry: true },
      )
      return { userId: data?.data?.id, username: data?.data?.display_name || data?.data?.username }
    } catch {
      return {}
    }
  }
}

export type { AuthManager, AuthStatus, UserProfile } from './types'