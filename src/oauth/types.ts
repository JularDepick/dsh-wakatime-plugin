/*
 * OAuth 2.0 模块类型定义
 * 作者: JularDepick
 *
 * 覆盖 WakaTime OAuth 授权流程所需的数据结构,
 * 具体端点与参数见 constants.ts。
 */

/* OAuth 应用凭证(优先取环境变量,可被配置覆盖) */
export interface OAuthCredentials {
  clientId: string
  clientSecret: string
}

/* 授权令牌对 */
export interface TokenPair {
  accessToken: string
  refreshToken: string
  /* 过期时刻(UNIX 秒) */
  expiresAt: number
  tokenType: string
}

/* 拉取到的授权回调结果 */
export interface OAuthCallbackResult {
  code: string
  state: string
}

/* 本地回调服务器句柄:promise 等待授权码,close 主动关闭 */
export interface CallbackServerHandle {
  codePromise: Promise<OAuthCallbackResult>
  close: () => void
}

/* OAuth 服务对外能力 */
export interface OAuthService {
  /* 构建授权 URL,state 用于防 CSRF */
  buildAuthorizeUrl(credentials: OAuthCredentials, redirectUri: string, state: string): string
  /* 启动本地回调服务器等待授权码,超时或关闭时拒绝 */
  startCallbackServer(port: number, timeoutMs?: number): CallbackServerHandle
  /* 用授权码换取令牌对 */
  exchangeCode(credentials: OAuthCredentials, redirectUri: string, code: string): Promise<TokenPair>
  /* 用刷新令牌续期,返回新令牌对 */
  refresh(credentials: OAuthCredentials, refreshToken: string): Promise<TokenPair>
  /* 撤销令牌并登出 */
  revoke(credentials: OAuthCredentials, token: string): Promise<void>
}