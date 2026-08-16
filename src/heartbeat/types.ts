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

/* 心跳引擎对外能力 */
export interface HeartbeatEngine {
  /* 发送单条心跳,含同实体防抖 */
  send(heartbeat: Heartbeat): Promise<void>
  /* 批量上报,单次最多 BULK_HEARTBEAT_LIMIT 条 */
  sendBatch(heartbeats: Heartbeat[]): Promise<void>
  /* 网络失败时进入本地离线队列,恢复后补报 */
  flushOfflineQueue(): Promise<void>
}