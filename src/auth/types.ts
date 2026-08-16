/*
 * 认证管理模块类型定义
 * 作者: JularDepick
 *
 * 组合 OAuth 与配置管理:凭证解析、令牌获取/刷新/持久化、登出。
 */

import type { OAuthCredentials, TokenPair } from '../oauth'

/* 已认证用户摘要 */
export interface UserProfile {
  userId?: string
  username?: string
}

/* 认证状态摘要(供 status 展示) */
export interface AuthStatus {
  authenticated: boolean
  username?: string
  userId?: string
  /* 令牌过期时刻(UNIX 秒) */
  expiresAt?: number
}

/* 认证管理器对外能力 */
export interface AuthManager {
  /* 解析生效凭证:环境变量优先,配置兜底 */
  getCredentials(): OAuthCredentials
  /* 确保有效令牌:未认证或刷新失败时抛出对应错误 */
  ensureValidToken(): Promise<string>
  /* 持久化令牌对,可同时回填用户资料 */
  saveToken(pair: TokenPair, profile?: UserProfile): Promise<void>
  /* 当前认证状态 */
  getStatus(): Promise<AuthStatus>
  /* 登出:撤销令牌并清除本地配置 */
  logout(): Promise<void>
  /* 拉取当前用户资料(登录成功后回填) */
  fetchUserProfile(token: string): Promise<UserProfile>
}