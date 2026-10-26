/*
 * Web UI 接口共享类型
 * 作者: JularDepick
 *
 * host 与浏览器端共用的 wire 类型:浏览器端仅 type-only 引用,
 * 打包时被擦除,不产生跨端 value 依赖。
 */

import type { StatsView } from '../bucket-store/resolve'
import type { CredentialSummary, CredentialType } from '../auth/types'
import type { DigitGrouping, StatsScope } from '../config'

/* 状态接口响应:认证状态 + 生效配置 + 按显示策略解析好的战绩视图 */
export interface WebStatusResponse {
  /* 是否已有可用凭证(明文永不回传) */
  configured: boolean
  /* 已存凭证数量 */
  count: number
  /* 激活凭证的类型与打码值 */
  activeType?: CredentialType
  activeMaskedSecret?: string
  username?: string
  /* 激活凭证是否来自环境变量(不落盘) */
  fromEnv: boolean
  config: {
    enabled: boolean
    reportInterval: number
    reportEnabled: boolean
    includeTokens: boolean
    includePrompts: boolean
    debug: boolean
    tableBorders: boolean
    statsScope: StatsScope
    digitGrouping: DigitGrouping
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
  digitGrouping?: DigitGrouping
}

/* 凭证添加请求:只提交原文,类型由小后端按前缀自动识别(仅覆盖写入,不提供查看) */
export interface WebCredentialPayload {
  secret: string
}

/* 凭证切换请求 */
export interface WebSwitchPayload {
  id: string
}

/* 凭证添加响应:ok 时携带摘要(不含明文)与账号名 */
export interface WebCredentialResponse {
  ok: boolean
  credential?: CredentialSummary
  username?: string | null
  /* 该凭证此前已存在,本次仅切换并刷新信息 */
  existed?: boolean
  /* 稳定错误码(empty / client_secret / unknown_format)或验证失败原因 */
  error?: string
}

/* 切换与移除的响应 */
export interface WebCredentialActionResponse {
  ok: boolean
  /* 稳定错误码(not_found / active) */
  error?: string
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
  /* 上报内容摘要(心跳类别计数与项目/分支) */
  detail?: string
  /* 失败任务标识:前端据此渲染手动重试入口 */
  taskId?: string
  /* 该失败任务是否由本进程持有(仅本进程可重试, 其它进程的记录只读) */
  retryable?: boolean
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

/* 凭证缓存(数据桶)条目:一份凭证一个桶, 另含无凭证归属的历史桶 */
export interface WebBucketEntry {
  /* 桶标识(= 凭证标识) */
  key: string
  /* 展示用模糊凭证(保留首尾各 8 字符, 其余 *);旧版桶回退为 #摘要 标识 */
  maskedKey: string
  /* 该桶归属凭证的类型与账号名(历史桶可能没有) */
  credentialType?: CredentialType
  username?: string
  /* 是否为当前激活凭证的桶 */
  active: boolean
  /* 该桶最后更新时刻(Unix 毫秒) */
  updatedAt: number
  /* 是否允许移除(非激活且已超过静默期) */
  removable: boolean
  /* 该凭证自己的战绩视图(仅此桶,不与其它凭证混算) */
  stats: StatsView
}

/* 凭证缓存清单响应 */
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
