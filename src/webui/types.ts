/*
 * Web UI 接口共享类型
 * 作者: JularDepick
 *
 * host 与浏览器端共用的 wire 类型:浏览器端仅 type-only 引用,
 * 打包时被擦除,不产生跨端 value 依赖.
 */

import type { StatsView } from '../local-store/resolve'
import type { LegacySource } from '../local-store'
import type { DigitGrouping } from '../config'
import type { TransmissionStatus } from '../heartbeat'

/* 单槽凭证状态(0.5.0 双槽: write 用 API Key, read 用 OAuth 令牌) */
export interface WebSlotStatus {
  /* 该槽是否已配置 */
  configured: boolean
  /* 是否由环境变量提供(不落盘) */
  fromEnv: boolean
  /* 打码值(明文永不回传) */
  maskedSecret?: string
  /* 该槽凭证最后写入时刻(Unix 毫秒) */
  updatedAt?: number
}

/* 状态接口响应:认证状态 + 生效配置 + 解析好的战绩视图 */
export interface WebStatusResponse {
  /* 两槽都已配置(上报与云端同步都可用) */
  configured: boolean
  /* 任一块凭证来自环境变量(不落盘) */
  fromEnv: boolean
  /* 写入槽状态(心跳上报用 API Key) */
  write: WebSlotStatus
  /* 读取槽状态(账号资料与云端战绩用 OAuth 令牌) */
  read: WebSlotStatus
  /* 账号名(读取槽解析) */
  username?: string
  /* 写入槽最近一次探测到的写权限 */
  writeScope?: 'ok' | 'missing' | 'unknown'
  /* 两槽是否同一账号; 任一槽变更后回到 unknown */
  sameAccount: 'same' | 'different' | 'unknown'
  /* 配置文件处于只读运行态(结构版本高于本插件支持版本): 界面据此提示并禁用写入 */
  readOnly?: boolean
  config: {
    enabled: boolean
    reportInterval: number
    reportEnabled: boolean
    includeTokens: boolean
    includePrompts: boolean
    debug: boolean
    tableBorders: boolean
    digitGrouping: DigitGrouping
  }
  /* 战绩视图(本地与云端已取最大值合并;渲染无需再合并) */
  stats: StatsView
  /* 检测到待迁移的旧版数据来源(界面据此显示红字提示); 无旧数据时不带该字段 */
  legacy?: LegacySource
  /* 上报运行态: 积压条数, 失败数, 最近一次成功时刻, 凭证是否被拒 */
  transmission: TransmissionStatus
}

/* 凭证保存请求: 只提交目标槽位与原文(仅覆盖写入, 不提供查看) */
export interface WebCredentialPayload {
  slot: 'write' | 'read'
  secret: string
}

/* 凭证保存响应 */
export interface WebCredentialResponse {
  ok: boolean
  /* 本次保存的槽位 */
  slot?: 'write' | 'read'
  /* 打码凭证与写入时刻 */
  maskedSecret?: string
  credentialUpdatedAt?: number
  username?: string | null
  /* 与已保存的是同一份凭证; replaced 表示之前存的是另一份(本次为更换) */
  existed?: boolean
  replaced?: boolean
  /* 写入槽的写权限探测结果 */
  writeScope?: 'ok' | 'missing' | 'unknown'
  /* 保存后两槽是否同一账号 */
  sameAccount?: 'same' | 'different' | 'unknown'
  /* 另一槽是否已配置(否则本次只保存了一半) */
  paired?: boolean
  /* 稳定错误码(empty / client_secret / api_key_format / oauth_format / wrong_slot /
     unknown_format / env_locked / write_scope / read_scope / network / different_account /
     config_readonly / persist_failed)或验证失败原因 */
  error?: string
}

/* 清除凭证请求: 给定槽位只清该槽, 缺省清两槽 */
export interface WebCredentialClearPayload {
  slot?: 'write' | 'read'
}

/* 清除凭证响应:失败时给出稳定错误码(如 env_locked);
   skipped 列出因环境变量占用而未清除的槽位(其余槽位已清除) */
export interface WebCredentialClearResponse {
  ok: boolean
  error?: string
  skipped?: ('write' | 'read')[]
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
  /* 稳定错误码: task not found(不在待重试列表) / push busy(已回队但本轮没能立刻投递) */
  error?: string
}

/* 旧版数据迁移响应:成功时带回迁移后的战绩视图,失败仅给原因 */
export interface WebMigrateResponse {
  ok: boolean
  data?: StatsView
  error?: string
}
