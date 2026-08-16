/*
 * 心跳上报模块类型定义
 * 作者: JularDepick
 *
 * 对齐 WakaTime Heartbeat API 的 AI 相关字段,上报维度见设计方案。
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
  aiInputTokens?: number
  aiOutputTokens?: number
  aiPromptLength?: number
  aiLineChanges?: number
  aiSession?: string
  /* 可选字段 */
  language?: string
  lines?: number
  isWrite?: boolean
}

/* 心跳引擎对外能力:初始化骨架阶段仅声明签名,实现待后续会话填充 */
export interface HeartbeatEngine {
  /* 发送单条心跳,含同实体防抖 */
  send(heartbeat: Heartbeat): Promise<void>
  /* 批量上报,单次最多 BULK_HEARTBEAT_LIMIT 条 */
  sendBatch(heartbeats: Heartbeat[]): Promise<void>
  /* 网络失败时进入本地离线队列,恢复后补报 */
  flushOfflineQueue(): Promise<void>
}