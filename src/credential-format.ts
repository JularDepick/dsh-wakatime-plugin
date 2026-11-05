/*
 * 凭证格式识别与打码(host 与浏览器端共用, 不含 Node 依赖)
 * 作者: JularDepick
 *
 * 0.5.0 起凭证分两槽, 各取自官方限定的用途(官方把 API Key 限定为写入专用,
 * 个人 OAuth 令牌限定为读取专用):
 * - 写入槽: API Key, 形如 waka_ 加 36 位 UUID(共 41 字符), 走 Basic 认证;
 * - 读取槽: 个人 OAuth 访问令牌, 形如 waka_tok_ 加随机串, 走 Bearer 认证;
 * waka_sec_ 是应用密钥(client secret), 两槽都不能用.
 */

import {
  API_KEY_LENGTH,
  API_KEY_PATTERN,
  CREDENTIAL_MIN_LENGTH,
  CREDENTIAL_PREFIX_API_KEY,
  CREDENTIAL_PREFIX_OAUTH,
  CREDENTIAL_MAX_LENGTH,
  CREDENTIAL_PREFIX_SECRET,
  KEY_MASK_EDGE_CHARS,
  KEY_MASK_STARS,
} from './constants'

/* 凭证类型: API Key(写入槽) 与 OAuth 访问令牌(读取槽) */
export type CredentialType = 'api_key' | 'oauth'

/* 凭证槽位: write(心跳上报)/ read(账号资料与云端战绩) */
export type CredentialSlot = 'write' | 'read'

/* 各槽接受的凭证类型(唯一, 便于提示「这一槽要哪种凭证」) */
export const SLOT_CREDENTIAL_TYPE: Record<CredentialSlot, CredentialType> = {
  write: 'api_key',
  read: 'oauth',
}

/* 识别失败原因:
   empty 空串 / client_secret 误填应用密钥 / api_key_format API Key 形态不符
   / oauth_format OAuth 令牌形态不符 / unknown 无法识别
   / wrong_slot 格式有效但属于另一个槽 */
export type CredentialRejectReason =
  | 'empty'
  | 'client_secret'
  | 'api_key_format'
  | 'oauth_format'
  | 'unknown'
  | 'wrong_slot'

/* 识别结果 */
export type CredentialDetection =
  | { ok: true, type: CredentialType }
  | { ok: false, reason: CredentialRejectReason }

/* 按前缀与长度识别凭证类型(与槽位无关): 先判更长的 waka_sec_ 与 waka_tok_ 前缀,
   避免 waka_ 分支把它们一起吃掉; API Key 长度固定为 API_KEY_LENGTH */
export function detectCredentialType(input: string): CredentialDetection {
  const value = input.trim()
  if (!value) return { ok: false, reason: 'empty' }
  if (value.startsWith(CREDENTIAL_PREFIX_SECRET)) return { ok: false, reason: 'client_secret' }
  if (value.startsWith(CREDENTIAL_PREFIX_OAUTH)) {
    /* 内部空白(粘贴多行/带换行)会让 Authorization 头非法, 请求层抛错后被当成网络失败,
       用户只会反复重试, 故在识别阶段就拒掉 */
    if (/\s/.test(value)) return { ok: false, reason: 'oauth_format' }
    if (value.length > CREDENTIAL_MAX_LENGTH) return { ok: false, reason: 'oauth_format' }
    return value.length >= CREDENTIAL_MIN_LENGTH
      ? { ok: true, type: 'oauth' }
      : { ok: false, reason: 'oauth_format' }
  }
  if (value.startsWith(CREDENTIAL_PREFIX_API_KEY)) {
    /* 形态与长度都要对: 前缀之外必须是标准 UUID, 总长固定为 API_KEY_LENGTH */
    if (!API_KEY_PATTERN.test(value)) return { ok: false, reason: 'api_key_format' }
    return value.length === API_KEY_LENGTH
      ? { ok: true, type: 'api_key' }
      : { ok: false, reason: 'api_key_format' }
  }
  return { ok: false, reason: 'unknown' }
}

/* 面向槽位识别: 形态有效的另一种凭证返回 wrong_slot, 让界面直接提示该槽要哪种凭证 */
export function detectSlotCredential(input: string, slot: CredentialSlot): CredentialDetection {
  const detection = detectCredentialType(input)
  if (!detection.ok) return detection
  if (detection.type !== SLOT_CREDENTIAL_TYPE[slot]) return { ok: false, reason: 'wrong_slot' }
  return detection
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
