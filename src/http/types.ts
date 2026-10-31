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

/* Authorization 头的构造结果: 0.4.0 起只有 Bearer(值为 OAuth 访问令牌原文);
   定义放在 http 层, 避免 http 反向依赖 auth 层 */
export interface AuthHeader {
  scheme: 'Bearer'
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
  /* 重试次数上限:用于交互式校验等需要快速失败的路径,缺省用全局默认 */
  maxRetries?: number
  /* 调用方可控的取消信号:与每次尝试自带的超时信号合并,取消后不再重试 */
  signal?: AbortSignal
}

/* HTTP 客户端对外能力 */
export interface HttpClient {
  /* 发起请求并按 2xx/非 2xx 解析 JSON 或抛出 WakaTimeError */
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>
}
