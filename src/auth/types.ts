/*
 * 认证管理模块类型定义
 * 作者: JularDepick
 *
 * 凭证分插件密钥与 OAuth 访问令牌两类, 地位相同: 都可用于上报与读取,
 * 仅认证方式(HTTP Basic / Bearer)不同; 列表与切换只暴露打码后的凭证.
 */

import type { AuthHeader } from '../http/types'

export type { CredentialRejectReason, CredentialType } from '../credential-format'

/* 凭证摘要(不含明文): 列表展示与切换使用 */
export interface CredentialSummary {
  /* 凭证标识(与数据桶标识同源) */
  id: string
  /* 凭证类型 */
  type: 'api_key' | 'oauth'
  /* 展示用打码凭证 */
  maskedSecret: string
  /* 验证成功时缓存的用户 id 与账号名 */
  userId?: string
  username?: string
  /* 是否为当前激活凭证 */
  active: boolean
  /* 加入与最近使用时刻(Unix 毫秒) */
  addedAt: number
  lastUsedAt: number
}

/* 已验证的账号资料 */
export interface UserProfile {
  userId?: string
  username?: string
}

/* 添加凭证的结果 */
export interface AddCredentialResult {
  summary: CredentialSummary
  profile: UserProfile
  /* 该凭证此前已存在(本次只是切换并刷新校验信息) */
  existed: boolean
}

export interface AuthStatus {
  /* 是否已有可用的激活凭证 */
  configured: boolean
  /* 已存凭证数量(环境变量注入的凭证不计入) */
  count: number
  /* 激活凭证的类型与打码值 */
  activeType?: 'api_key' | 'oauth'
  activeMaskedSecret?: string
  /* 账号名 */
  username?: string
  /* 激活凭证是否来自环境变量(不落盘) */
  fromEnv: boolean
}

export interface AuthManager {
  /* 当前激活凭证的认证头;未配置时抛 NotAuthenticatedError */
  getAuthHeader(): Promise<AuthHeader>
  /* 当前激活凭证原文(数据桶归属用);未配置时返回 null */
  getActiveSecret(): Promise<string | null>
  /* 全部已存凭证摘要(不含明文, 不含环境变量注入项) */
  listCredentials(): Promise<CredentialSummary[]>
  /* 添加凭证: 自动识别类型 -> 经服务端验证 -> 落盘并设为激活;格式或有效性不通过时抛 CredentialInputError */
  addCredential(input: string): Promise<AddCredentialResult>
  /* 切换激活凭证 */
  switchCredential(id: string): Promise<CredentialSummary>
  /* 移除凭证(不影响其它凭证与其本地缓存) */
  removeCredential(id: string): Promise<void>
  /* 清除全部已存凭证(本地数据桶保留) */
  clearCredentials(): Promise<void>
  /* 凭证变更订阅 */
  onChange(listener: () => void): () => void
  getStatus(): Promise<AuthStatus>
  /* 用认证头拉取账号资料, 顺带验证凭证有效性 */
  fetchUserProfile(header: AuthHeader): Promise<UserProfile>
}
