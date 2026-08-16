/*
 * OAuth 2.0 登录模块实现
 * 作者: JularDepick
 *
 * 本地回调服务器方案:插件启动临时 HTTP 服务器接收浏览器重定向,
 * 换取令牌后立即关闭。令牌端点经 Basic 认证(clientSecret 缺省时降级为
 * public client 模式,不携带认证头)。
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { OAUTH_AUTHORIZE_URL, OAUTH_CALLBACK_PATH, OAUTH_REVOKE_URL, OAUTH_SCOPES, OAUTH_TOKEN_URL } from '../constants'
import { FetchHttpClient } from '../http'
import type { HttpClient } from '../http'
import type { CallbackServerHandle, OAuthCallbackResult, OAuthCredentials, OAuthService, TokenPair } from './types'

/* WakaTime 令牌端点响应形状 */
interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

/* 默认回调等待时长:5 分钟 */
const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export class OAuthModule implements OAuthService {
  private readonly http: HttpClient

  constructor(http: HttpClient = new FetchHttpClient()) {
    this.http = http
  }

  buildAuthorizeUrl(credentials: OAuthCredentials, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES,
      state,
    })
    return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`
  }

  startCallbackServer(port: number, timeoutMs: number = DEFAULT_CALLBACK_TIMEOUT_MS): CallbackServerHandle {
    let server: Server | undefined
    let timeout: NodeJS.Timeout | undefined
    let settled = false

    const codePromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
      server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
        if (url.pathname !== OAUTH_CALLBACK_PATH) {
          response.writeHead(404)
          response.end('Not Found')
          return
        }
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        if (code) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end('<html><body><h1>Authorization succeeded.</h1><p>You can close this window.</p></body></html>')
          settled = true
          resolve({ code, state: state ?? '' })
        } else {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end('<html><body><h1>Authorization failed.</h1><p>Missing authorization code.</p></body></html>')
          settled = true
          reject(new Error('回调缺少授权码'))
        }
        close()
      })

      server.on('error', (error) => {
        if (settled) return
        settled = true
        reject(new Error(`回调服务器启动失败: ${(error as Error).message}`))
      })

      /* 双栈监听:兼容浏览器对 localhost 的 IPv4/IPv6 解析 */
      server.listen(port)

      timeout = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('等待授权回调超时'))
        close()
      }, timeoutMs)
    })

    const close = () => {
      if (timeout) clearTimeout(timeout)
      if (server) server.close()
    }

    return { codePromise, close }
  }

  async exchangeCode(credentials: OAuthCredentials, redirectUri: string, code: string): Promise<TokenPair> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: credentials.clientId,
    })
    if (credentials.clientSecret) form.set('client_secret', credentials.clientSecret)
    const response = await this.http.request<TokenResponse>(OAUTH_TOKEN_URL, {
      method: 'POST',
      form,
      basicAuth: this.basicAuth(credentials),
    })
    return toTokenPair(response)
  }

  async refresh(credentials: OAuthCredentials, refreshToken: string): Promise<TokenPair> {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: credentials.clientId,
    })
    if (credentials.clientSecret) form.set('client_secret', credentials.clientSecret)
    const response = await this.http.request<TokenResponse>(OAUTH_TOKEN_URL, {
      method: 'POST',
      form,
      basicAuth: this.basicAuth(credentials),
    })
    return toTokenPair(response)
  }

  async revoke(credentials: OAuthCredentials, token: string): Promise<void> {
    const form = new URLSearchParams({ token })
    await this.http.request(OAUTH_REVOKE_URL, {
      method: 'POST',
      form,
      basicAuth: this.basicAuth(credentials),
      noRetry: true,
    })
  }

  /* clientSecret 存在时构造 Basic 认证头 */
  private basicAuth(credentials: OAuthCredentials): string | undefined {
    if (!credentials.clientSecret) return undefined
    return Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')
  }
}

/* 令牌响应归一化为 TokenPair */
function toTokenPair(response: TokenResponse): TokenPair {
  return {
    accessToken: response.access_token,
    /* refresh_token 可能缺省(部分授权服务仅在首次发放) */
    refreshToken: response.refresh_token ?? '',
    expiresAt: Math.floor(Date.now() / 1000) + response.expires_in,
    tokenType: response.token_type,
  }
}

export type { CallbackServerHandle, OAuthCallbackResult, OAuthCredentials, OAuthService, TokenPair } from './types'