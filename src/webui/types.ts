/*
 * Web UI 接口共享类型
 * 作者: JularDepick
 *
 * host 与浏览器端共用的 wire 类型:浏览器端仅 type-only 引用,
 * 打包时被擦除,不产生跨端 value 依赖。
 */

import type { SessionStats } from '../stats'

/* 状态接口响应:认证状态 + 生效配置 + 会话战绩 */
export interface WebStatusResponse {
  authenticated: boolean
  username?: string
  expiresAt?: number
  config: {
    enabled: boolean
    locale: string
    clientId: string
    /* 是否已配置 clientSecret(值本身不回传) */
    clientSecretSet: boolean
    callbackPort: number
    heartbeatInterval: number
    includeTokens: boolean
    includePrompts: boolean
    debug: boolean
  }
  stats: {
    aggregate: SessionStats
    sessions: SessionStats[]
  }
}

/* 配置写入请求:Web 可编辑字段子集(与 WebConfigPatch 对齐) */
export interface WebConfigPayload {
  enabled?: boolean
  locale?: string
  clientId?: string
  callbackPort?: number
  heartbeatInterval?: number
  includeTokens?: boolean
  includePrompts?: boolean
  debug?: boolean
}

/* 配置写入响应 */
export interface WebConfigResponse {
  ok: boolean
}
