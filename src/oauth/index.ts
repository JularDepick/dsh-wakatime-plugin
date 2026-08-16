/*
 * OAuth 2.0 登录模块(占位)
 * 作者: JularDepick
 *
 * 初始化阶段仅声明结构与能力边界,功能实现留待后续会话按 AGENTS.md 指示进行。
 */

import { NotImplementedError } from '../errors'
import type { OAuthCallbackResult, OAuthService, TokenPair } from './types'

export class OAuthModule implements OAuthService {
  buildAuthorizeUrl(): string {
    throw new NotImplementedError('OAuth 授权 URL 构建')
  }

  async waitForCallback(): Promise<OAuthCallbackResult> {
    throw new NotImplementedError('OAuth 本地回调服务器')
  }

  async exchangeCode(): Promise<TokenPair> {
    throw new NotImplementedError('OAuth 授权码换令牌')
  }

  async refresh(): Promise<TokenPair> {
    throw new NotImplementedError('OAuth 令牌刷新')
  }

  async revoke(): Promise<void> {
    throw new NotImplementedError('OAuth 令牌撤销')
  }
}

export type { OAuthCredentials, OAuthCallbackResult, OAuthService, TokenPair } from './types'