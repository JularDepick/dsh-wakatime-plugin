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

/* 请求选项:与 fetch 对齐的最小面 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /* JSON 请求体 */
  body?: unknown
  /* Bearer 令牌(用于 API 请求) */
  bearer?: string
  /* Basic 认证(OAuth 令牌端点使用,值为 base64(clientId:clientSecret)) */
  basicAuth?: string
  /* 表单体(OAuth 令牌端点使用) */
  form?: URLSearchParams
  /* 关闭重试(默认开启,429/5xx 指数退避) */
  noRetry?: boolean
}

/* HTTP 客户端对外能力 */
export interface HttpClient {
  /* 发起请求并按 2xx/非 2xx 解析 JSON 或抛出 WakaTimeError */
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>
}