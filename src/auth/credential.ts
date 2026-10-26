/*
 * 凭证对象(统一基类 + 两种实现)
 * 作者: JularDepick
 *
 * 插件密钥与 OAuth 访问令牌同权: 同一基类描述身份(id/打码/类型),
 * 子类只负责各自的认证头构造; 上报与读取统一按当前激活凭证取认证头.
 */

import { createHash } from 'node:crypto'
import type { AuthHeader } from '../http/types'
import { maskCredential } from '../credential-format'
import type { CredentialType } from '../credential-format'

/* 凭证标识: 凭证原文的 sha256 摘要前 16 位, 同时用作数据桶标识,
   故"一份凭证一份本地数据"与"一个桶"天然一一对应(不含明文) */
export function credentialIdOf(secret: string): string {
  return createHash('sha256').update(secret.trim()).digest('hex').slice(0, 16)
}

/* 凭证基类: 身份与展示信息在此, 认证头由子类实现 */
export abstract class CredentialBase {
  /* 凭证类型(插件密钥 / OAuth 访问令牌) */
  abstract readonly type: CredentialType

  constructor(readonly secret: string) {}

  /* 稳定标识(数据桶标识同源) */
  get id(): string {
    return credentialIdOf(this.secret)
  }

  /* 展示用打码凭证 */
  get maskedSecret(): string {
    return maskCredential(this.secret)
  }

  /* 该凭证对应的 Authorization 头 */
  abstract authHeader(): AuthHeader
}

/* 插件密钥: 官方插件认证口径, HTTP Basic 的 username 取密钥本身 */
export class ApiKeyCredential extends CredentialBase {
  readonly type: CredentialType = 'api_key'

  authHeader(): AuthHeader {
    return { scheme: 'Basic', value: Buffer.from(this.secret + ':').toString('base64') }
  }
}

/* OAuth 访问令牌: Bearer 认证 */
export class OauthCredential extends CredentialBase {
  readonly type: CredentialType = 'oauth'

  authHeader(): AuthHeader {
    return { scheme: 'Bearer', value: this.secret }
  }
}

/* 按类型构造凭证对象 */
export function credentialOf(type: CredentialType, secret: string): CredentialBase {
  return type === 'oauth' ? new OauthCredential(secret.trim()) : new ApiKeyCredential(secret.trim())
}
