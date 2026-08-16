/*
 * HTTP 客户端实现(基于 Node 内置 fetch)
 * 作者: JularDepick
 *
 * 负责 WakaTime REST API 的请求封装:JSON 编解码、错误分类、
 * 429/5xx 指数退避重试。令牌获取与刷新由调用方(心跳引擎)负责。
 */

import {
  RETRY_BACKOFF_MULTIPLIER,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_RETRIES,
  WAKATIME_API_BASE,
} from '../constants'
import type { HttpClient, RequestOptions } from './types'
import { WakaTimeError } from './types'

/* 可重试的 HTTP 状态:限流与服务器错误 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/* 按指数退避等待 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class FetchHttpClient implements HttpClient {
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${WAKATIME_API_BASE}${path}`
    const method = options.method ?? 'GET'

    const headers: Record<string, string> = {}
    if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`
    if (options.basicAuth) headers.Authorization = `Basic ${options.basicAuth}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.form) headers['Content-Type'] = 'application/x-www-form-urlencoded'

    const init: RequestInit = { method, headers }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    if (options.form) init.body = options.form.toString()

    const maxRetries = options.noRetry ? 0 : RETRY_MAX_RETRIES
    let attempt = 0
    for (;;) {
      attempt++
      let response: Response
      try {
        response = await fetch(url, init)
      } catch (error) {
        /* 网络层失败:按服务器错误对待,进入重试 */
        const last = attempt > maxRetries
        if (last) throw new WakaTimeError(0, `网络请求失败: ${(error as Error).message}`)
        await this.backoff(attempt)
        continue
      }

      /* 2xx:解析 JSON 返回 */
      if (response.status >= 200 && response.status < 300) {
        const text = await response.text()
        if (!text) return undefined as T
        try {
          return JSON.parse(text) as T
        } catch {
          return text as T
        }
      }

      /* 可重试状态:限流与服务器错误 */
      const last = attempt > maxRetries
      if (isRetryableStatus(response.status) && !last) {
        await this.backoff(attempt)
        continue
      }

      /* 不可重试或重试耗尽:解析错误体后抛出 */
      let message = `WakaTime API 返回 ${response.status}`
      let code: string | undefined
      try {
        const text = await response.text()
        const parsed = text ? JSON.parse(text) : undefined
        if (parsed && typeof parsed === 'object') {
          const err = parsed as { error?: string; message?: string }
          code = err.error
          message = err.message || err.error || message
        }
      } catch {
        /* 错误体不是 JSON,保留状态码摘要 */
      }
      throw new WakaTimeError(response.status, message, code)
    }
  }

  /* 指数退避:base * multiplier^attempt,封顶 max */
  private async backoff(attempt: number): Promise<void> {
    const delay = Math.min(RETRY_BASE_DELAY_MS * RETRY_BACKOFF_MULTIPLIER ** (attempt - 1), RETRY_MAX_DELAY_MS)
    await sleep(delay)
  }
}

export { WakaTimeError } from './types'
export type { HttpClient, RequestOptions } from './types'