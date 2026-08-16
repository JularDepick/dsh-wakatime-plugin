/*
 * 心跳上报模块类型定义
 * 作者: JularDepick
 *
 * 字段名直接对齐 WakaTime Heartbeat API(snake_case)。
 */

/* 心跳分类:与 WakaTime category 枚举对齐 */
export type HeartbeatCategory = 'coding' | 'debugging' | 'researching' | 'ai coding' | 'learning'

/* 心跳实体类型 */
export type HeartbeatEntityType = 'file' | 'app' | 'domain' | 'url'

/* 单条心跳数据(WakaTime Heartbeat API 字段) */
export interface Heartbeat {
  /* 必填:会话标识或文件路径 */
  entity: string
  type: HeartbeatEntityType
  /* UNIX 时间戳(秒) */
  time: number
  category?: HeartbeatCategory
  project?: string
  branch?: string
  /* AI Agent 专属字段 */
  ai_input_tokens?: number
  ai_output_tokens?: number
  ai_prompt_length?: number
  ai_line_changes?: number
  ai_session?: string
  /* 可选字段 */
  language?: string
  lines?: number
  is_write?: boolean
}

/* 一次定时批量上报的结果记录(调试日志,Web 可展开查看) */
export interface ReportLogEntry {
  /* 上报时刻(Unix 毫秒) */
  time: number
  /* 本批心跳条数 */
  count: number
  /* 是否成功 */
  ok: boolean
  /* 失败原因(ok=false 时) */
  error?: string
}

/* 心跳引擎对外能力 */
export interface HeartbeatEngine {
  /* 入队一条心跳(本地缓冲,不立即发送) */
  enqueue(heartbeat: Heartbeat): void
  /* 定时批量上报:发送缓冲内全部心跳并清空;失败进入离线队列补报 */
  flushBuffered(): Promise<void>
  /* 离线队列补报(网络恢复或定时调用) */
  flushOfflineQueue(): Promise<void>
  /* 最近上报记录(调试日志) */
  reportLogs(): readonly ReportLogEntry[]
}
