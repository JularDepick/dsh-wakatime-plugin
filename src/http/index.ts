/*
 * HTTP 客户端实现(基于 Node 内置 fetch)
 * 作者: JularDepick
 *
 * 负责 WakaTime REST API 的请求封装:JSON 编解码、错误分类、
 * 429/5xx 指数退避重试。令牌获取与刷新由调用方(心跳引擎)负责。
 */

import {
  REQUEST_TIMEOUT_MS,
  RETRY_BACKOFF_MULTIPLIER,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_RETRIES,
  WAKATIME_API_BASE,
} from '../constants'
import type { HttpClient, RequestOptions } from './types'
import { WakaTimeError } from './types'
import { userAgent } from '../useragent'

/* 可重试的 HTTP 状态:限流与服务器错误 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/* 按指数退避等待: 定时器不持有事件循环, 否则退避期间(最长 RETRY_MAX_DELAY_MS)会拖住宿主退出 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/* 本次尝试的取消信号:单次请求超时与调用方取消合二为一,任一触发即中止 fetch */
function signalOf(caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return caller === undefined ? timeout : AbortSignal.any([timeout, caller])
}

export class FetchHttpClient implements HttpClient {
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${WAKATIME_API_BASE}${path}`
    const method = options.method ?? 'GET'

    const headers: Record<string, string> = {
      /* WakaTime 从 User-Agent 解析 Editor 与 OS(缺失时报表显示 Unknown) */
      'User-Agent': userAgent(),
    }
    if (options.auth) headers.Authorization = options.auth.scheme + ' ' + options.auth.value
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    /* 不自动跟随跳转: 官方用 302 作为限流提示, 跟随会拿到 200 的 HTML 页并误判为非 JSON 失败 */
    const init: RequestInit = { method, headers, redirect: 'manual' }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)

    const maxRetries = options.noRetry ? 0 : (options.maxRetries ?? RETRY_MAX_RETRIES)
    let attempt = 0
    for (;;) {
      attempt++
      let response: Response
      try {
        /* 每次尝试独立计时:超时按网络失败处理,避免请求挂起阻塞上报循环;
           调用方的取消信号与超时信号合并, 取消时底层 fetch 一并中止 */
        response = await fetch(url, { ...init, signal: signalOf(options.signal) })
      } catch (error) {
        /* 调用方取消:不再重试,直接上抛 */
        if (options.signal?.aborted) throw new WakaTimeError(0, 'request aborted')
        /* 网络层失败:按服务器错误对待,进入重试 */
        const last = attempt > maxRetries
        if (last) throw new WakaTimeError(0, `Network request failed: ${(error as Error).message}`)
        await this.backoff(attempt)
        continue
      }

      /* 2xx:解析 JSON 返回. 2xx 却不是 JSON 时按错误处理:
         登录页、门户/代理拦截页、HTML 错误页都可能回 200, 当成成功会让整批心跳被静默丢弃 */
      if (response.status >= 200 && response.status < 300) {
        const text = await response.text()
        if (!text) return undefined as T
        try {
          return JSON.parse(text) as T
        } catch {
          throw new WakaTimeError(response.status, 'WakaTime API returned a non-JSON response')
        }
      }

      /* 可重试状态:限流与服务器错误 */
      const last = attempt > maxRetries
      if (isRetryableStatus(response.status) && !last) {
        await this.backoff(attempt)
        continue
      }

      /* 官方文档: 有时用 302 代替 429 提醒放慢请求节奏(fetch 默认会跟随跳转,
         拿到的 200 HTML 会被当成非 JSON 响应失败), 因此这里按重定向处理并按退避重试 */
      if (response.status >= 300 && response.status < 400) {
        if (attempt > maxRetries) throw new WakaTimeError(429, 'WakaTime API redirected (rate limit hint)')
        await this.backoff(attempt)
        continue
      }

      /* 不可重试或重试耗尽:解析错误体后抛出 */
      let message = `WakaTime API responded with status ${response.status}`
      let code: string | undefined
      try {
        const text = await response.text()
        const parsed = text ? JSON.parse(text) : undefined
        if (parsed && typeof parsed === 'object') {
          /* 官方文档: 错误可能放在 errors 数组或 error 键, 两者都要读, 否则真实原因会被状态码摘要盖掉 */
          const body = parsed as { error?: unknown; message?: unknown; errors?: unknown }
          const list = Array.isArray(body.errors)
            ? body.errors.filter((item): item is string => typeof item === 'string')
            : []
          const fromError = typeof body.error === 'string' ? body.error : ''
          const fromMessage = typeof body.message === 'string' ? body.message : ''
          code = fromError === '' ? undefined : fromError
          message = fromMessage || fromError || list.join('; ') || message
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
export type { AuthHeader, HttpClient, RequestOptions } from './types'