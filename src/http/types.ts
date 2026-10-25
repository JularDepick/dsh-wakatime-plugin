/*
 * HTTP 层类型定义
 * 作者: JularDepick
 */

/* WakaTime API 错误:携带 HTTP 状态与响应体摘要 */
export class WakaTimeError extends Error {
  /* HTTP 状态码,网络层失败时为 0 */
  readonly status: number
  /* 响应体中的错误码(如有) */
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'WakaTimeError'
    this.status = status
    this.code = code
  }
}

/* Authorization 头的构造结果:
   Basic 值为 API Key 拼接冒号后的 base64(官方插件认证口径),
   Bearer 值为 OAuth 访问令牌原文;
   定义放在 http 层, 避免 http 反向依赖 auth 层 */
export interface AuthHeader {
  scheme: 'Basic' | 'Bearer'
  value: string
}

/* 请求选项:与 fetch 对齐的最小面 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /* JSON 请求体 */
  body?: unknown
  /* 认证头(由 auth 层按端点用途与凭证种类构造;缺省为匿名请求) */
  auth?: AuthHeader
  /* 关闭重试(默认开启,429/5xx 指数退避) */
  noRetry?: boolean
}

/* HTTP 客户端对外能力 */
export interface HttpClient {
  /* 发起请求并按 2xx/非 2xx 解析 JSON 或抛出 WakaTimeError */
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>
}
