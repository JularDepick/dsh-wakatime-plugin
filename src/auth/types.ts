/*
 * 认证管理模块类型定义
 * 作者: JularDepick
 */

import type { AuthHeader } from '../http/types'
import type { EndpointUsage } from '../constants'

/* 凭证种类: WakaTime 插件密钥(API Key, HTTP Basic)与 OAuth 访问令牌(Bearer)。
   官方口径: API Key 属插件凭证, 只授权提交编码活动; 其余用途(含账号与战绩读取)
   应使用 OAuth 访问令牌, 2026-11-01 起生效 */
export type CredentialKind = 'api_key' | 'oauth'

/* 按端点用途解析出的生效凭证 */
export interface ResolvedCredential {
  /* 实际使用的凭证种类 */
  kind: CredentialKind
  /* 写入 Authorization 的认证头 */
  header: AuthHeader
}

/* 已验证的账号资料(用于界面展示账号名) */
export interface UserProfile {
  /* WakaTime 用户 id */
  userId?: string
  /* 展示用账号名:依次取 username、full_name、display_name、email、id */
  username?: string
}

export interface AuthStatus {
  /* 是否已配置任一可用凭证 */
  configured: boolean
  /* 是否已配置插件 API Key */
  apiKeyConfigured: boolean
  /* 是否已配置 OAuth 访问令牌 */
  oauthConfigured: boolean
  /* 心跳上报面实际生效的凭证种类 */
  kind?: CredentialKind
  /* 已配置时缓存的 WakaTime 用户名 */
  username?: string
}

export interface AuthManager {
  /* 当前生效的 API Key:未配置时抛 NotAuthenticatedError */
  getApiKey(): Promise<string>
  /* 当前生效的 API Key;未配置时返回 null(供不抛错的调用方使用) */
  tryGetApiKey(): Promise<string | null>
  /* 当前生效的 OAuth 访问令牌:未配置时抛 NotAuthenticatedError */
  getOauthToken(): Promise<string>
  /* 当前生效的 OAuth 访问令牌;未配置时返回 null */
  tryGetOauthToken(): Promise<string | null>
  /* 数据桶归属用的凭证原文:写活动面优先 API Key, 只有令牌时取令牌, 两者都无时 null */
  getCredentialSecret(): Promise<string | null>
  /* 按端点用途解析生效凭证与认证头;两种凭证都未配置时抛 NotAuthenticatedError */
  getCredential(usage: EndpointUsage): Promise<ResolvedCredential>
  /* 订阅凭证变更(覆盖写入或清除后触发);返回取消订阅函数 */
  onChange(listener: () => void): () => void
  /* 覆盖写入 API Key:先经验证, 验证失败抛错且不保存 */
  setApiKey(apiKey: string): Promise<UserProfile>
  /* 覆盖写入 OAuth 访问令牌:同上 */
  setOauthToken(token: string): Promise<UserProfile>
  /* 当前认证状态(配置情况) */
  getStatus(): Promise<AuthStatus>
  /* 只清除 API Key(保留 OAuth 令牌) */
  clearApiKey(): Promise<void>
  /* 清除本地全部凭证(API Key 与 OAuth 令牌) */
  clearCredential(): Promise<void>
  /* 用认证头拉取账号资料, 顺带验证凭证有效性 */
  fetchUserProfile(header: AuthHeader): Promise<UserProfile>
}
