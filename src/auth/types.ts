/*
 * 认证管理模块类型定义
 * 作者: JularDepick
 *
 * 0.4.0 起只支持一份 OAuth 访问令牌: 上报与读取共用它,
 * 更换凭证直接覆盖, 本地数据不随凭证变化.
 */

import type { AuthHeader } from '../http/types'

export type { CredentialRejectReason, CredentialType } from '../credential-format'

/* 已验证的账号资料 */
export interface UserProfile {
  userId?: string
  username?: string
}

/* 保存凭证的结果(不含明文) */
export interface SetCredentialResult {
  /* 展示用打码凭证 */
  maskedSecret: string
  /* 账号名(读取权限不足时缺省) */
  username?: string
  /* 与已保存的是同一份凭证(内容相同) */
  existed: boolean
}

export interface AuthStatus {
  /* 是否已有可用凭证 */
  configured: boolean
  /* 凭证是否来自环境变量(不落盘) */
  fromEnv: boolean
  /* 展示用打码凭证 */
  maskedSecret?: string
  /* 账号名 */
  username?: string
  /* 凭证最后写入时刻(Unix 毫秒) */
  updatedAt?: number
}

export interface AuthManager {
  /* 当前凭证的认证头;未配置时抛 NotAuthenticatedError */
  getAuthHeader(): Promise<AuthHeader>
  /* 当前凭证原文(仅 host 内部使用);未配置时返回 null */
  getSecret(): Promise<string | null>
  /* 保存凭证(覆盖已有凭证):格式校验 -> 服务端验证 -> 落盘;不通过时抛 CredentialInputError */
  setCredential(input: string): Promise<SetCredentialResult>
  /* 清除已保存凭证(本地数据保留) */
  clearCredential(): Promise<void>
  /* 凭证变更订阅 */
  onChange(listener: () => void): () => void
  getStatus(): Promise<AuthStatus>
  /* 用认证头拉取账号资料, 顺带验证凭证有效性 */
  fetchUserProfile(header: AuthHeader): Promise<UserProfile>
}
