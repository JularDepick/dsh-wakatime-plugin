/*
 * 凭证对象
 * 作者: JularDepick
 *
 * 0.4.0 起只支持 OAuth 访问令牌(Bearer 认证).
 */

import type { AuthHeader } from '../http/types'
import { maskCredential } from '../credential-format'

export class OauthCredential {
  readonly type = 'oauth' as const

  constructor(readonly secret: string) {}

  /* 展示用打码凭证 */
  get maskedSecret(): string {
    return maskCredential(this.secret)
  }

  /* 该凭证对应的 Authorization 头 */
  authHeader(): AuthHeader {
    return { scheme: 'Bearer', value: this.secret }
  }
}
