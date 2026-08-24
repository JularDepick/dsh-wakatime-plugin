/*
 * 认证错误定义
 * 作者: JularDepick
 */

/* 未认证:尚未配置 API Key,需先完成配置 */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('WakaTime API key not configured')
    this.name = 'NotAuthenticatedError'
  }
}
