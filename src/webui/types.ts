/*
 * Web UI 接口共享类型
 * 作者: JularDepick
 *
 * host 与浏览器端共用的 wire 类型:浏览器端仅 type-only 引用,
 * 打包时被擦除,不产生跨端 value 依赖。
 */

import type { SessionStats } from '../stats'

/* 状态接口响应:认证状态 + 生效配置 + 全局战绩 */
export interface WebStatusResponse {
  /* 是否已配置 API Key(明文永不回传) */
  configured: boolean
  username?: string
  config: {
    enabled: boolean
    reportInterval: number
    reportEnabled: boolean
    includeTokens: boolean
    includePrompts: boolean
    debug: boolean
  }
  stats: {
    aggregate: SessionStats
  }
}

/* 配置写入请求:Web 可编辑字段子集(与 WebConfigPatch 对齐,不含凭证与语言) */
export interface WebConfigPayload {
  enabled?: boolean
  reportInterval?: number
  reportEnabled?: boolean
  includeTokens?: boolean
  includePrompts?: boolean
  debug?: boolean
}

/* API Key 覆盖写入请求(仅覆盖,不提供查看) */
export interface WebApiKeyPayload {
  apiKey: string
}

/* 配置写入响应 */
export interface WebConfigResponse {
  ok: boolean
}

/* 上报记录日志条目(调试级,可展开查看) */
export interface WebLogEntry {
  time: number
  count: number
  ok: boolean
  error?: string
}
