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
  /* 缓存命中 TOKEN(输入侧命中提示词缓存的量):官方心跳字段表没有对应项,
     按自定义扩展字段上报,官方若不识别则忽略(本地始终保留该指标) */
  ai_cache_read_tokens?: number
  /* 本机机器名:WakaTime Machines 维度(官方 POST 字段表未列出,官方 CLI 仍会发送) */
  machine_name?: string
  /* 可选字段 */
  language?: string
  lines?: number
  is_write?: boolean
}

/* 待发送队列条目:心跳本体、入队时刻(Unix 毫秒)与已尝试次数 */
export interface PendingHeartbeatEntry {
  heartbeat: Heartbeat
  enqueuedAt: number
  attempts: number
}

/* 推送失败任务:尝试次数耗尽后移出队列并持久化,可由用户在 Web 上报记录里手动重试 */
export interface FailedPushTask {
  /* 任务标识:上报记录行与手动重试入口据此关联 */
  id: string
  heartbeat: Heartbeat
  attempts: number
  enqueuedAt: number
  failedAt: number
}

/* 上报记录条目:batch 为一次批量上报的结果,task 为重试耗尽的单条任务 */
export interface ReportEntry {
  id: string
  /* 记录时刻(Unix 毫秒) */
  time: number
  kind: 'batch' | 'task'
  /* 本次涉及的心跳条数(batch 为批量条数,task 恒为 1) */
  count: number
  ok: boolean
  /* 失败行状态机:failed 待用户处理,retried 已被用户手动重试过 */
  state?: 'failed' | 'retried'
  error?: string
  /* 失败行对应的失败任务 id(仅 task 行,供前端渲染重试入口) */
  taskId?: string
}

/* 待发送心跳状态:队列 + 失败任务 + 上报记录(落盘用,重启后继续推送) */
export interface PendingHeartbeatState {
  queue: PendingHeartbeatEntry[]
  failed: FailedPushTask[]
  report: ReportEntry[]
}

/* 心跳引擎对外能力 */
export interface HeartbeatEngine {
  /* 入队一条心跳(追加到待发送队列尾部,不立即发送) */
  enqueue(heartbeat: Heartbeat): void
  /* 推送一轮:取队首一批发送,成功出队、可重试失败回队尾、失败耗尽进失败列表 */
  push(): Promise<void>
  /* 等待在途推送结束(切换数据桶前调用,避免在途批次被并入新桶) */
  whenIdle(): Promise<void>
  /* 手动重试一条失败任务:移回队列尾并重置尝试次数;返回是否找到该任务 */
  retryFailedTask(id: string): boolean
  /* 载入待发送状态并与当前队列合并(启动时用;不丢弃启动瞬间已入队的心跳) */
  restorePending(state: PendingHeartbeatState): void
  /* 替换待发送状态(切换数据桶时用:清空后载入目标桶) */
  replacePending(state: PendingHeartbeatState): void
  /* 当前待发送状态快照(供落盘) */
  pendingState(): PendingHeartbeatState
  /* 上报记录(时间最近优先由前端处理) */
  reportLog(): readonly ReportEntry[]
}
