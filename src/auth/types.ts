/*
 * 认证管理模块类型定义
 * 作者: JularDepick
 *
 * 0.5.0 起凭证分两槽: 写入槽(API Key)负责心跳上报, 读取槽(个人 OAuth 令牌)负责
 * 账号资料与云端战绩; 两槽缺一即视为未配置(上报暂停但队列保留), 且必须指向同一个
 * WakaTime 用户. 本地数据与凭证无关, 更换或清除凭证都不丢数据.
 */

import type { AuthHeader } from '../http/types'
import type { CredentialSlot } from '../credential-format'

export type { CredentialRejectReason, CredentialSlot, CredentialType } from '../credential-format'

/* 已验证的账号资料 */
export interface UserProfile {
  userId?: string
  username?: string
}

/* 两槽是否指向同一账号的判定结论 */
export type SameAccountVerdict = 'same' | 'different' | 'unknown'

/* 单槽状态(读取面, 不含明文) */
export interface SlotStatus {
  /* 该槽是否已有可用凭证 */
  configured: boolean
  /* 凭证是否来自环境变量(不落盘) */
  fromEnv: boolean
  /* 展示用打码凭证 */
  maskedSecret?: string
  /* 凭证最后写入时刻(Unix 毫秒) */
  updatedAt?: number
}

/* 保存单槽凭证的结果(不含明文) */
export interface SetCredentialResult {
  /* 本次保存的槽位 */
  slot: CredentialSlot
  /* 展示用打码凭证 */
  maskedSecret: string
  /* 账号名(只有读取槽能解析出账号名) */
  username?: string
  /* 与已保存的是同一份凭证(内容相同) */
  existed: boolean
  /* 之前保存的是另一份凭证(内容不同), 即本次为更换 */
  replaced: boolean
  /* 凭证写盘时刻 */
  updatedAt: number
  /* 写入槽的写权限探测结果: 被拒时心跳会被服务端拒绝(missing), 网络异常时为 unknown */
  writeScope?: 'ok' | 'missing' | 'unknown'
  /* 保存后两槽是否指向同一账号 */
  sameAccount: SameAccountVerdict
  /* 另一槽当前是否已配置(未配置时本次保存只完成一半, 上报仍暂停) */
  paired: boolean
}

export interface AuthStatus {
  /* 两槽都已配置(上报与云端同步都可用) */
  configured: boolean
  /* 任一块凭证来自环境变量(不落盘) */
  fromEnv: boolean
  /* 写入槽状态(API Key) */
  write: SlotStatus
  /* 读取槽状态(OAuth 令牌) */
  read: SlotStatus
  /* 账号名(读取槽解析) */
  username?: string
  /* 账号标识(读取槽解析) */
  userId?: string
  /* 写入槽最近一次探测到的写权限 */
  writeScope?: 'ok' | 'missing' | 'unknown'
  /* 两槽是否同一账号; 任一槽变更后回到 unknown */
  sameAccount: SameAccountVerdict
}

export interface AuthManager {
  /* 写入槽认证头(API Key, Basic);未配置时抛 NotAuthenticatedError */
  getWriteAuthHeader(): Promise<AuthHeader>
  /* 读取槽认证头(OAuth 令牌, Bearer);未配置时抛 NotAuthenticatedError */
  getReadAuthHeader(): Promise<AuthHeader>
  /* 写入槽凭证原文(仅 host 内部使用);未配置时返回 null */
  getWriteSecret(): Promise<string | null>
  /* 读取槽凭证原文(仅 host 内部使用);未配置时返回 null */
  getReadSecret(): Promise<string | null>
  /* 保存单槽凭证(覆盖该槽已有凭证):格式校验 -> 服务端验证 -> 同账号取证 -> 落盘 */
  setCredential(slot: CredentialSlot, input: string): Promise<SetCredentialResult>
  /* 清除凭证: 给定槽位只清该槽, 缺省清两槽(本地数据保留) */
  clearCredential(slot?: CredentialSlot): Promise<void>
  /* 凭证变更订阅 */
  onChange(listener: () => void): () => void
  getStatus(): Promise<AuthStatus>
  /* 用认证头拉取账号资料, 顺带验证凭证有效性 */
  fetchUserProfile(header: AuthHeader, signal?: AbortSignal): Promise<UserProfile>
}
