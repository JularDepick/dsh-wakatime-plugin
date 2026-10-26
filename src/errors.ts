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

/* 凭证操作失败原因:
   empty 空输入 / client_secret 误填应用密钥 / unknown_format 无法识别的格式
   not_found 凭证不存在 / active 该凭证正被使用,须先切换 */
export type CredentialErrorCode = 'empty' | 'client_secret' | 'unknown_format' | 'not_found' | 'active'

/* 凭证输入或操作不合法(由小后端映射为可读错误码下发) */
export class CredentialInputError extends Error {
  readonly code: CredentialErrorCode

  constructor(code: CredentialErrorCode) {
    super(code)
    this.name = 'CredentialInputError'
    this.code = code
  }
}
