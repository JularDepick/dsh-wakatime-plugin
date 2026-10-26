/*
 * 认证错误定义
 * 作者: JularDepick
 */

/* 未认证:尚未配置可用凭证,需先完成配置 */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('WakaTime credential not configured')
    this.name = 'NotAuthenticatedError'
  }
}

/* 凭证输入失败原因:
   empty 空输入 / client_secret 误填应用密钥 / api_key 误填插件密钥(0.4.0 起不再支持)
   / unknown_format 无法识别的格式 */
export type CredentialErrorCode = 'empty' | 'client_secret' | 'api_key' | 'unknown_format'

/* 凭证输入或操作不合法(由小后端映射为可读错误码下发) */
export class CredentialInputError extends Error {
  readonly code: CredentialErrorCode

  constructor(code: CredentialErrorCode) {
    super(code)
    this.name = 'CredentialInputError'
    this.code = code
  }
}
