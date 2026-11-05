/*
 * 认证错误定义
 * 作者: JularDepick
 */

/* 未认证:尚未配置可用凭证,需先完成配置(两槽缺一即视为未配置) */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('WakaTime credential not configured')
    this.name = 'NotAuthenticatedError'
  }
}

/* 凭证输入失败原因:
   empty 空输入 / client_secret 误填应用密钥
   / api_key_format API Key 形态不符 / oauth_format OAuth 令牌形态不符
   / unknown_format 无法识别的格式 / wrong_slot 格式有效但填在了另一个槽
   / env_locked 该槽由环境变量提供, 改配置不会生效
   / write_scope 写入槽凭证被服务端拒绝(无效或缺写入权限)
   / read_scope 读取槽凭证被服务端拒绝(无效或缺读取权限)
   / network 验证时网络异常 / different_account 两槽不属于同一个 WakaTime 用户 */
export type CredentialErrorCode =
  | 'empty'
  | 'client_secret'
  | 'api_key_format'
  | 'oauth_format'
  | 'unknown_format'
  | 'wrong_slot'
  | 'env_locked'
  | 'write_scope'
  | 'read_scope'
  | 'network'
  | 'different_account'

/* 凭证输入或操作不合法(由小后端映射为可读错误码下发) */
export class CredentialInputError extends Error {
  readonly code: CredentialErrorCode

  constructor(code: CredentialErrorCode) {
    super(code)
    this.name = 'CredentialInputError'
    this.code = code
  }
}
