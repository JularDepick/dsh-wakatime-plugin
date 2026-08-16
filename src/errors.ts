/*
 * 认证错误定义
 * 作者: JularDepick
 */

/* 未认证:尚无有效令牌,需先完成 OAuth 登录 */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('尚未完成 WakaTime 授权')
    this.name = 'NotAuthenticatedError'
  }
}

/* 令牌刷新失败:需重新登录 */
export class TokenRefreshError extends Error {
  constructor(message: string) {
    super(`令牌刷新失败: ${message}`)
    this.name = 'TokenRefreshError'
  }
}