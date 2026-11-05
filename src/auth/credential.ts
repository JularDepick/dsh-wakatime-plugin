/*
 * 凭证对象
 * 作者: JularDepick
 *
 * 0.5.0 起双槽: 写入槽用 API Key(HTTP Basic), 读取槽用个人 OAuth 访问令牌(Bearer).
 * 两种凭证都只保存原文, 打码值供读取面展示, 明文不出 host 进程.
 */

import type { AuthHeader } from '../http/types'
import type { CredentialType } from '../credential-format'
import { maskCredential } from '../credential-format'

/* 槽位凭证的共同面 */
export interface SlotCredential {
  readonly type: CredentialType
  readonly secret: string
  /* 展示用打码凭证 */
  readonly maskedSecret: string
  /* 该凭证对应的 Authorization 头 */
  authHeader(): AuthHeader
}

/*
 * 写入槽凭证: WakaTime API Key.
 * 官方文档: 把 API Key 直接 base64 编码后放进 Authorization 头(示例 12345 -> Basic MTIzNDU=),
 * 解码结果就是密钥原文(不带冒号), 与 ?api_key= 查询参数等价.
 */
export class ApiKeyCredential implements SlotCredential {
  readonly type = 'api_key' as const

  constructor(readonly secret: string) {}

  get maskedSecret(): string {
    return maskCredential(this.secret)
  }

  authHeader(): AuthHeader {
    return { scheme: 'Basic', value: Buffer.from(this.secret, 'utf8').toString('base64') }
  }
}

/* 读取槽凭证: 个人 OAuth 访问令牌 */
export class OauthCredential implements SlotCredential {
  readonly type = 'oauth' as const

  constructor(readonly secret: string) {}

  get maskedSecret(): string {
    return maskCredential(this.secret)
  }

  authHeader(): AuthHeader {
    return { scheme: 'Bearer', value: this.secret }
  }
}
