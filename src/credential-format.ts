/*
 * 凭证格式识别与打码(host 与浏览器端共用, 不含 Node 依赖)
 * 作者: JularDepick
 *
 * WakaTime 凭证按前缀区分类型:
 * - 插件密钥(API Key): waka_ 加 UUID, 官方插件提交编码活动用它;
 * - OAuth 访问令牌: waka_tok_ 开头;
 * - OAuth 应用密钥: waka_sec_ 开头, 属应用客户端密钥, 不能当凭证使用, 需明确拒绝.
 * 类型识别两端共用同一实现: 浏览器端保存前做格式校验, 小后端再做权威识别与有效性校验.
 */

import {
  CREDENTIAL_MIN_LENGTH,
  CREDENTIAL_PREFIX_API_KEY,
  CREDENTIAL_PREFIX_OAUTH,
  CREDENTIAL_PREFIX_SECRET,
  KEY_MASK_EDGE_CHARS,
  KEY_MASK_STARS,
} from './constants'

/* 凭证类型: 插件密钥与 OAuth 访问令牌同权, 只有认证方式不同 */
export type CredentialType = 'api_key' | 'oauth'

/* 识别失败原因: 空串 / 误填应用密钥 / 无法识别的格式 */
export type CredentialRejectReason = 'empty' | 'client_secret' | 'unknown'

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
  if (value.startsWith(CREDENTIAL_PREFIX_API_KEY) && value.length >= CREDENTIAL_MIN_LENGTH) {
    return { ok: true, type: 'api_key' }
  }
  return { ok: false, reason: 'unknown' }
}

/* 展示用打码: 保留首尾各 KEY_MASK_EDGE_CHARS 个字符, 其余以 * 代替;
   长度不足 2 倍边长的串整体打码, 避免露出过多有效信息 */
export function maskCredential(secret: string): string {
  const value = secret.trim()
  if (value.length <= KEY_MASK_EDGE_CHARS * 2) return '*'.repeat(value.length)
  const head = value.slice(0, KEY_MASK_EDGE_CHARS)
  const tail = value.slice(-KEY_MASK_EDGE_CHARS)
  /* 中间段固定星号个数, 不按实际隐藏位数展开: 既避免泄露长度, 也避免长凭证在界面上占过多宽度 */
  return head + '*'.repeat(KEY_MASK_STARS) + tail
}
