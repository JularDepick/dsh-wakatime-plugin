/*
 * Web UI 接口共享类型
 * 作者: JularDepick
 *
 * host 与浏览器端共用的 wire 类型:浏览器端仅 type-only 引用,
 * 打包时被擦除,不产生跨端 value 依赖。
 */

import type { StatsView } from '../bucket-store/resolve'
import type { StatsScope } from '../config'

/* 状态接口响应:认证状态 + 生效配置 + 按显示策略解析好的战绩视图 */
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
    tableBorders: boolean
    statsScope: StatsScope
  }
  /* 战绩视图(桶内已与云端取最大,跨桶按策略求和;渲染无需再合并) */
  stats: StatsView
}

/* 配置写入请求:Web 可编辑字段子集(与 WebConfigPatch 对齐,不含凭证与语言) */
export interface WebConfigPayload {
  enabled?: boolean
  reportInterval?: number
  reportEnabled?: boolean
  includeTokens?: boolean
  includePrompts?: boolean
  debug?: boolean
  tableBorders?: boolean
  statsScope?: StatsScope
}

/* API Key 覆盖写入请求(仅覆盖,不提供查看) */
export interface WebApiKeyPayload {
  apiKey: string
}

/* 配置写入响应 */
export interface WebConfigResponse {
  ok: boolean
}

/* 上报记录条目:batch 为一次批量上报的结果,task 为尝试耗尽的单条任务 */
export interface WebLogEntry {
  id: string
  /* 记录时刻(Unix 毫秒) */
  time: number
  kind: 'batch' | 'task'
  /* 涉及的心跳条数 */
  count: number
  ok: boolean
  /* 失败行状态机:failed 待处理,retried 已被用户重试过 */
  state?: 'failed' | 'retried'
  error?: string
  /* 失败任务标识:前端据此渲染手动重试入口 */
  taskId?: string
  /* 失败任务对应的心跳对象与已尝试次数 */
  entity?: string
  attempts?: number
}

/* 云端同步响应:ok=true 携带解析后的战绩视图;失败仅返回原因 */
export interface WebSyncResponse {
  ok: boolean
  data?: StatsView
  error?: string
}

/* 手动重试失败任务:请求体与响应 */
export interface WebRetryPayload {
  id: string
}

export interface WebRetryResponse {
  ok: boolean
  error?: string
}

/* API Key 缓存(数据桶)条目:模糊 Key + 该 Key 自己的战绩视图 */
export interface WebBucketEntry {
  /* 桶标识(API Key 的 sha256 摘要前 16 位) */
  key: string
  /* 展示用模糊 Key(保留首尾各 8 字符,其余 *);旧版桶回退为 #摘要 标识 */
  maskedKey: string
  /* 该桶最后更新时刻(Unix 毫秒) */
  updatedAt: number
  /* 是否为当前生效的 Key */
  current: boolean
  /* 是否允许移除(非当前 Key 且已超过静默期) */
  removable: boolean
  /* 该 Key 自己的战绩视图(仅此桶,不与其它 Key 混算) */
  stats: StatsView
}

/* API Key 缓存清单响应 */
export interface WebBucketsResponse {
  buckets: WebBucketEntry[]
}

/* 手动移除一个数据桶:请求体与响应(移除后由前端重新拉取落盘数据) */
export interface WebBucketRemovePayload {
  key: string
}

export interface WebBucketRemoveResponse {
  ok: boolean
  /* 稳定标识: bucket-in-use / bucket-not-removable / bucket-not-found */
  error?: string
}
