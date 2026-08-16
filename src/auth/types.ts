/*
 * 认证管理模块类型定义
 * 作者: JularDepick
 *
 * 基于 WakaTime API Key 的认证管理:Key 只允许覆盖写入,
 * 任何读取面(工具、Web 接口)均不返回明文。
 */

/* 已认证用户摘要 */
export interface UserProfile {
  userId?: string
  username?: string
}

/* 认证状态摘要(供 status 展示,不含 Key 明文) */
export interface AuthStatus {
  /* 是否已配置 API Key */
  configured: boolean
  /* 最近验证成功的用户名(如有) */
  username?: string
}

/* 认证管理器对外能力 */
export interface AuthManager {
  /* 读取 API Key(内存缓存;未配置或环境变量缺失时抛出 NotAuthenticatedError) */
  getApiKey(): Promise<string>
  /* 覆盖设置 API Key:先验证有效性,成功后才持久化并更新内存缓存 */
  setApiKey(apiKey: string): Promise<UserProfile>
  /* 当前认证状态(不回显 Key) */
  getStatus(): Promise<AuthStatus>
  /* 清除本地 API Key(登出) */
  clearApiKey(): Promise<void>
  /* 用给定 Key 拉取用户资料(验证用) */
  fetchUserProfile(apiKey: string): Promise<UserProfile>
}
