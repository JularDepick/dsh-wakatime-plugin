/*
 * 凭证格式识别与打码(host 与浏览器端共用, 不含 Node 依赖)
 * 作者: JularDepick
 *
 * 0.4.0 起只接受 OAuth 访问令牌: 官方把插件密钥限定为写入专用,
 * 而战绩读取与云端同步都需要读取权限, 故统一使用个人 OAuth 令牌.
 * 凭证前缀: waka_tok_ 访问令牌; waka_ 插件密钥(拒绝并提示改用令牌);
 * waka_sec_ 应用密钥(client secret), 不能当凭证使用.
 */

import {
  CREDENTIAL_MIN_LENGTH,
  CREDENTIAL_PREFIX_API_KEY,
  CREDENTIAL_PREFIX_OAUTH,
  CREDENTIAL_PREFIX_SECRET,
  KEY_MASK_EDGE_CHARS,
  KEY_MASK_STARS,
} from './constants'

/* 凭证类型: 只保留 OAuth 访问令牌 */
export type CredentialType = 'oauth'

/* 识别失败原因: 空串 / 误填应用密钥 / 误填插件密钥 / 无法识别的格式 */
export type CredentialRejectReason = 'empty' | 'client_secret' | 'api_key' | 'unknown'

/* 识别结果 */
export type CredentialDetection =
  | { ok: true, type: CredentialType }
  | { ok: false, reason: CredentialRejectReason }

/* 按前缀识别凭证类型; 前缀之外还需满足最短长度, 避免把半截串当凭证 */
export function detectCredentialType(input: string): CredentialDetection {
  const value = input.trim()
  if (!value) return { ok: false, reason: 'empty' }
  if (value.startsWith(CREDENTIAL_PREFIX_SECRET)) return { ok: false, reason: 'client_secret' }
  if (value.startsWith(CREDENTIAL_PREFIX_OAUTH) && value.length >= CREDENTIAL_MIN_LENGTH) {
    return { ok: true, type: 'oauth' }
  }
  if (value.startsWith(CREDENTIAL_PREFIX_API_KEY)) return { ok: false, reason: 'api_key' }
  return { ok: false, reason: 'unknown' }
}

/* 展示用打码: 保留首尾各 KEY_MASK_EDGE_CHARS 个字符, 其余以固定数量星号代替;
   长度不足 2 倍边长的串整体打码 */
export function maskCredential(secret: string): string {
  const value = secret.trim()
  if (value.length <= KEY_MASK_EDGE_CHARS * 2) return '*'.repeat(value.length)
  const head = value.slice(0, KEY_MASK_EDGE_CHARS)
  const tail = value.slice(-KEY_MASK_EDGE_CHARS)
  return head + '*'.repeat(KEY_MASK_STARS) + tail
}
