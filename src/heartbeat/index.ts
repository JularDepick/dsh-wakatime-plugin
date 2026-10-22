/*
 * 心跳推送引擎实现
 * 作者: JularDepick
 *
 * 单队列推送模型:采集面把心跳追加到待发送队列尾部(不立即发送),
 * 推送轮(push)从队首取一批发送:
 * - 批量大小 = 积压 < PUSH_BATCH_THRESHOLD 时取 1 条;否则取 积压 ÷ PUSH_BATCH_DIVISOR
 *   (向下取整,并以 WakaTime bulk 上限 BULK_HEARTBEAT_LIMIT 截断),整批放进同一次请求,
 *   每条心跳保留自己的身份与时间戳(零失真);
 * - 成功:整批出队并记一条 batch 上报记录;
 * - 可重试失败(429/5xx/网络):整批回队尾,逐条累加尝试次数,达到 PUSH_TASK_MAX_ATTEMPTS
 *   的进入失败列表并各记一条 task 失败记录;
 * - 终态失败(401/403/400/404/422):不重试,直接进失败列表并记录;
 * - 未配置 API Key:不算失败、不计尝试次数,整批放回队首并结束本轮(换 Key 后自然续推)。
 * 未达到队列上限时不做任何压缩,心跳数量与时间戳保持原样。
 * 队列、失败列表与上报记录经 onPendingChange 通知调用方落盘(防抖),
 * 启动与切换数据桶时经 restorePending 载入。
 */

import { randomUUID } from 'node:crypto'
import {
  BULK_HEARTBEAT_LIMIT,
  FAILED_TASK_LIMIT,
  HEARTBEATS_BULK_PATH,
  HEARTBEATS_PATH,
  PENDING_QUEUE_LIMIT,
  PUSH_BATCH_DIVISOR,
  PUSH_BATCH_THRESHOLD,
  PUSH_TASK_MAX_ATTEMPTS,
  REPORT_LOG_LIMIT,
} from '../constants'
import { NotAuthenticatedError } from '../errors'
import type { HttpClient } from '../http'
import { WakaTimeError } from '../http'
import { compressPendingQueue } from './compress'
import type {
  FailedPushTask,
  Heartbeat,
  HeartbeatCategory,
  HeartbeatEngine,
  HeartbeatEntityType,
  PendingHeartbeatEntry,
  PendingHeartbeatState,
  ReportEntry,
} from './types'

/* 令牌提供者:每次请求前由调用方确保有效令牌 */
export type TokenProvider = () => Promise<string>

/* 调试日志接口:与 ctx.logger 相容的最小面 */
export interface EngineLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
  error?: (message: string) => void
}

export interface HeartbeatEngineOptions {
  /* 是否启用上报;关闭时心跳直接丢弃 */
  enabled: boolean
  /* 是否携带 Token 用量字段 */
  includeTokens: boolean
  /* 是否携带提示词长度字段 */
  includePrompts: boolean
  logger?: EngineLogger
  /* 待发送状态变更回调(供落盘;调用方自行防抖) */
  onPendingChange?: (state: PendingHeartbeatState) => void
}

export class HeartbeatEngineImpl implements HeartbeatEngine {
  private readonly http: HttpClient
  private readonly tokenProvider: TokenProvider
  /* 可变选项:Web 设置页写入后经 updateOptions 即时生效 */
  private options: HeartbeatEngineOptions
  /* 待发送队列(队首优先推送) */
  private queue: PendingHeartbeatEntry[] = []
  /* 失败任务(尝试次数耗尽,等待用户手动重试) */
  private failed: FailedPushTask[] = []
  /* 上报记录(调试级,最近 REPORT_LOG_LIMIT 条) */
  private report: ReportEntry[] = []
  /* 推送轮重入保护:同一时刻只允许一轮推送 */
  private pushing = false
  /* 在途推送的完成信号:切换数据桶前用 whenIdle 等待它结算 */
  private inFlight: Promise<void> | undefined

  constructor(http: HttpClient, tokenProvider: TokenProvider, options: HeartbeatEngineOptions) {
    this.http = http
    this.tokenProvider = tokenProvider
    this.options = options
  }

  /* 更新运行选项(enabled/字段裁剪),不替换 logger 与落盘回调 */
  updateOptions(patch: Partial<HeartbeatEngineOptions>): void {
    this.options = { ...this.options, ...patch }
  }

  /* 入队一条心跳:追加到队尾并按上限压缩(仅在超限时) */
  enqueue(heartbeat: Heartbeat): void {
    if (!this.options.enabled) return
    this.queue.push({ heartbeat: this.prepare(heartbeat), enqueuedAt: Date.now(), attempts: 0 })
    this.compressIfNeeded()
    this.notifyPending()
  }

  /* 推送一轮:取队首一批发送并结算结果 */
  async push(): Promise<void> {
    if (!this.options.enabled) return
    if (this.pushing) return
    const size = this.batchSize()
    if (size === 0) return
    this.pushing = true
    const task = this.deliverBatch(size)
    this.inFlight = task
    try {
      await task
    } finally {
      this.pushing = false
      this.inFlight = undefined
    }
  }

  /* 等待在途推送结束(无在途时立即返回):切换数据桶前调用,
     让在途批次的出队/重排/上报记录仍然结算在旧桶 */
  async whenIdle(): Promise<void> {
    while (this.inFlight !== undefined) await this.inFlight.catch(() => {})
  }

  /* 结算一批推送:成功整批出队,失败按终态/可重试分类 */
  private async deliverBatch(size: number): Promise<void> {
    const batch = this.queue.splice(0, size)
    try {
      await this.deliver(batch.map((entry) => entry.heartbeat))
      this.appendReport({ kind: 'batch', count: batch.length, ok: true, ...detailOf(batch) })
      this.log('info', `[wakatime] pushed ${batch.length} heartbeats`)
    } catch (error) {
      /* 未配置 API Key:不丢失、不计尝试次数,整批放回队首保持顺序 */
      if (error instanceof NotAuthenticatedError) {
        this.queue.unshift(...batch)
        this.log('info', '[wakatime] API key not configured, heartbeat kept in queue')
        return
      }
      const message = (error as Error).message
      const terminal = isTerminalError(error)
      for (const entry of batch) {
        const attempts = entry.attempts + 1
        if (terminal || attempts >= PUSH_TASK_MAX_ATTEMPTS) {
          this.appendFailedTask({ ...entry, attempts }, message)
        } else {
          this.queue.push({ ...entry, attempts })
        }
      }
      this.appendReport({ kind: 'batch', count: batch.length, ok: false, error: message, ...detailOf(batch) })
      this.log('warn', `[wakatime] push failed (${terminal ? 'terminal' : 'retryable'}): ${message}`)
    } finally {
      this.compressIfNeeded()
      this.notifyPending()
    }
  }

  /* 手动重试一条失败任务:移回队尾并重置尝试次数,原失败记录标记为已重试 */
  retryFailedTask(id: string): boolean {
    const index = this.failed.findIndex((task) => task.id === id)
    if (index < 0) return false
    const [task] = this.failed.splice(index, 1)
    if (!task) return false
    this.queue.push({ heartbeat: task.heartbeat, enqueuedAt: Date.now(), attempts: 0 })
    for (const entry of this.report) {
      if (entry.taskId === id && entry.state === 'failed') entry.state = 'retried'
    }
    this.log('info', `[wakatime] failed task ${id} requeued for retry`)
    this.notifyPending()
    return true
  }

  /* 载入待发送状态并与当前队列合并:启动时用,启动瞬间已入队的心跳不会被覆盖 */
  restorePending(state: PendingHeartbeatState): void {
    this.queue = [...state.queue.map((entry) => ({ ...entry })), ...this.queue]
    this.failed = [...state.failed.map((task) => ({ ...task })), ...this.failed]
    this.report = [...state.report.map((entry) => ({ ...entry })), ...this.report].slice(-REPORT_LOG_LIMIT)
    this.compressIfNeeded()
    this.notifyPending()
  }

  /* 替换待发送状态(切换数据桶时用:清空后载入目标桶) */
  replacePending(state: PendingHeartbeatState): void {
    this.queue = state.queue.map((entry) => ({ ...entry }))
    this.failed = state.failed.map((task) => ({ ...task }))
    this.report = state.report.map((entry) => ({ ...entry }))
    this.compressIfNeeded()
    this.notifyPending()
  }

  /* 当前待发送状态快照(供落盘;返回副本) */
  pendingState(): PendingHeartbeatState {
    return {
      queue: this.queue.map((entry) => ({ ...entry })),
      failed: this.failed.map((task) => ({ ...task })),
      report: this.report.map((entry) => ({ ...entry })),
    }
  }

  /* 上报记录(追加顺序,由前端按时间倒序展示) */
  reportLog(): readonly ReportEntry[] {
    return this.report
  }

  /* 本批推送条数:积压不足阈值时逐条,达到阈值后按积压 ÷ 除数(受 bulk 上限截断) */
  private batchSize(): number {
    const backlog = this.queue.length
    if (backlog === 0) return 0
    if (backlog < PUSH_BATCH_THRESHOLD) return 1
    return Math.max(1, Math.min(BULK_HEARTBEAT_LIMIT, Math.floor(backlog / PUSH_BATCH_DIVISOR)))
  }

  /* 队列超限时做一次相邻两条合并压缩(保留较早那条 + AI 计数相加) */
  private compressIfNeeded(): void {
    if (this.queue.length <= PENDING_QUEUE_LIMIT) return
    const result = compressPendingQueue(this.queue, PENDING_QUEUE_LIMIT)
    this.queue = result.queue
    this.log('warn', `[wakatime] pending queue over limit, compressed ${result.merged} heartbeats`)
  }

  /* 记一条上报记录 */
  private appendReport(entry: Omit<ReportEntry, 'id' | 'time'>): void {
    this.report.push({ ...entry, id: randomUUID(), time: Date.now() })
    if (this.report.length > REPORT_LOG_LIMIT) this.report.splice(0, this.report.length - REPORT_LOG_LIMIT)
  }

  /* 记一条失败任务(附一条可点击重试的 task 记录) */
  private appendFailedTask(entry: PendingHeartbeatEntry, error: string): void {
    const task: FailedPushTask = {
      id: randomUUID(),
      heartbeat: entry.heartbeat,
      attempts: entry.attempts,
      enqueuedAt: entry.enqueuedAt,
      failedAt: Date.now(),
    }
    this.failed.push(task)
    if (this.failed.length > FAILED_TASK_LIMIT) this.failed.splice(0, this.failed.length - FAILED_TASK_LIMIT)
    this.appendReport({ kind: 'task', count: 1, ok: false, state: 'failed', error, taskId: task.id, ...detailOf([entry]) })
  }

  /* 上报一批:单条走 heartbeats,多条走 bulk */
  private async deliver(heartbeats: Heartbeat[]): Promise<void> {
    const token = await this.tokenProvider()
    if (heartbeats.length === 1) {
      await this.http.request(HEARTBEATS_PATH, {
        method: 'POST',
        body: heartbeats[0],
        basicAuth: token,
        noRetry: true,
      })
      return
    }
    for (let index = 0; index < heartbeats.length; index += BULK_HEARTBEAT_LIMIT) {
      const chunk = heartbeats.slice(index, index + BULK_HEARTBEAT_LIMIT)
      await this.http.request(HEARTBEATS_BULK_PATH, {
        method: 'POST',
        body: chunk,
        basicAuth: token,
        noRetry: true,
      })
    }
  }

  /* 按配置裁剪可选字段 */
  private prepare(heartbeat: Heartbeat): Heartbeat {
    const copy: Heartbeat = {
      entity: heartbeat.entity,
      type: heartbeat.type,
      time: heartbeat.time,
      category: heartbeat.category,
      project: heartbeat.project,
      branch: heartbeat.branch,
      language: heartbeat.language,
      lines: heartbeat.lines,
      /* 队列压缩会把相邻两条的 AI 计数(含行变动)相加,故裁剪时需一并转发 */
      ai_line_changes: heartbeat.ai_line_changes,
      is_write: heartbeat.is_write,
      ai_session: heartbeat.ai_session,
      machine_name: heartbeat.machine_name,
    }
    if (this.options.includeTokens) {
      copy.ai_input_tokens = heartbeat.ai_input_tokens
      copy.ai_output_tokens = heartbeat.ai_output_tokens
      /* 缓存命中 TOKEN 随 Token 用量字段一并裁剪(自定义扩展字段,官方无对应项) */
      copy.ai_cache_read_tokens = heartbeat.ai_cache_read_tokens
    }
    if (this.options.includePrompts) {
      copy.ai_prompt_length = heartbeat.ai_prompt_length
    }
    return copy
  }

  /* 待发送状态变更通知(落盘由调用方防抖) */
  private notifyPending(): void {
    this.options.onPendingChange?.(this.pendingState())
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.logger?.[level]?.(message)
  }
}

/* 上报记录详情:心跳类别计数与项目/分支(失败行的原因另记 error,由界面并列展示)。
   内容只由心跳字段拼成,不含自然语言,故不随界面语言变化 */
function describeHeartbeats(entries: readonly PendingHeartbeatEntry[]): string {
  const counts = new Map<string, number>()
  const projects = new Set<string>()
  const branches = new Set<string>()
  for (const { heartbeat } of entries) {
    if (heartbeat.category !== undefined) counts.set(heartbeat.category, (counts.get(heartbeat.category) ?? 0) + 1)
    if (heartbeat.project !== undefined && heartbeat.project !== '') projects.add(heartbeat.project)
    if (heartbeat.branch !== undefined && heartbeat.branch !== '') branches.add(heartbeat.branch)
  }
  const parts = [...counts].map(([category, count]) => (count > 1 ? `${category} ×${count}` : category))
  /* 项目与分支只有在本批完全一致时才写,混合批次只保留类别计数 */
  const project = projects.size === 1 ? [...projects][0] : undefined
  const branch = branches.size === 1 ? [...branches][0] : undefined
  if (project !== undefined) parts.push(branch !== undefined ? `${project}@${branch}` : project)
  return parts.join(' · ')
}

/* 详情字段的就绪形态:无内容时不写该字段(旧记录与空批次保持原样) */
function detailOf(entries: readonly PendingHeartbeatEntry[]): { detail?: string } {
  const detail = describeHeartbeats(entries)
  return detail === '' ? {} : { detail }
}

/* 终态失败判定:认证/载荷类错误重试无意义,直接进失败列表(429 与 5xx 仍可重试) */
function isTerminalError(error: unknown): boolean {
  if (!(error instanceof WakaTimeError)) return false
  return error.status === 400 || error.status === 401 || error.status === 403
    || error.status === 404 || error.status === 422
}

/* 心跳实体类型与分类的合法取值(恢复快照时的白名单) */
const ENTITY_TYPES: readonly HeartbeatEntityType[] = ['file', 'app', 'domain', 'url']
const CATEGORIES: readonly HeartbeatCategory[] = ['coding', 'debugging', 'researching', 'ai coding', 'learning']
/* 快照中的字符串字段与数值字段白名单(其余字段一律丢弃) */
const STRING_FIELDS = ['project', 'branch', 'ai_session', 'machine_name', 'language'] as const
const NUMBER_FIELDS = ['ai_input_tokens', 'ai_output_tokens', 'ai_prompt_length', 'ai_line_changes', 'ai_cache_read_tokens', 'lines'] as const

/* 单条心跳归一化:只接受白名单字段与合法类型,损坏或被篡改的文件内容不会进入上报载荷 */
function normalizeHeartbeat(value: unknown): Heartbeat | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.entity !== 'string' || raw.entity === '') return undefined
  if (typeof raw.type !== 'string' || !ENTITY_TYPES.includes(raw.type as HeartbeatEntityType)) return undefined
  if (typeof raw.time !== 'number' || !Number.isFinite(raw.time) || raw.time <= 0) return undefined
  const heartbeat: Heartbeat = {
    entity: raw.entity,
    type: raw.type as HeartbeatEntityType,
    time: raw.time,
  }
  if (typeof raw.category === 'string' && CATEGORIES.includes(raw.category as HeartbeatCategory)) {
    heartbeat.category = raw.category as HeartbeatCategory
  }
  for (const key of STRING_FIELDS) {
    const field = raw[key]
    if (typeof field === 'string') heartbeat[key] = field
  }
  for (const key of NUMBER_FIELDS) {
    const field = raw[key]
    if (typeof field === 'number' && Number.isFinite(field) && field >= 0) heartbeat[key] = field
  }
  if (typeof raw.is_write === 'boolean') heartbeat.is_write = raw.is_write
  return heartbeat
}

/* 非负整数归一化 */
function nonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/* 待发送状态归一化:丢弃无效条目,队列与失败列表按上限只保留最新一批 */
export function normalizePendingState(value: unknown): PendingHeartbeatState {
  const state: PendingHeartbeatState = { queue: [], failed: [], report: [] }
  if (typeof value !== 'object' || value === null) return state
  const raw = value as { queue?: unknown, buffer?: unknown, failed?: unknown, report?: unknown }
  /* buffer 为旧版字段(单缓冲模型),按队列条目迁移 */
  const legacyBuffer = Array.isArray(raw.buffer) ? raw.buffer : []
  const queueRaw = [...legacyBuffer, ...(Array.isArray(raw.queue) ? raw.queue : [])].slice(-PENDING_QUEUE_LIMIT)
  for (const item of queueRaw) {
    if (typeof item !== 'object' || item === null) continue
    /* 旧版条目是裸心跳,新版是 { heartbeat, enqueuedAt, attempts } */
    const candidate = 'heartbeat' in item ? (item as { heartbeat?: unknown, enqueuedAt?: unknown, attempts?: unknown }) : undefined
    const heartbeat = normalizeHeartbeat(candidate ? candidate.heartbeat : item)
    if (!heartbeat) continue
    state.queue.push({
      heartbeat,
      enqueuedAt: nonNegative(candidate?.enqueuedAt, 0),
      attempts: nonNegative(candidate?.attempts, 0),
    })
  }
  if (Array.isArray(raw.failed)) {
    for (const item of raw.failed.slice(-FAILED_TASK_LIMIT)) {
      if (typeof item !== 'object' || item === null) continue
      const candidate = item as { id?: unknown, heartbeat?: unknown, attempts?: unknown, enqueuedAt?: unknown, failedAt?: unknown }
      const heartbeat = normalizeHeartbeat(candidate.heartbeat)
      if (!heartbeat) continue
      state.failed.push({
        id: typeof candidate.id === 'string' && candidate.id !== '' ? candidate.id : randomUUID(),
        heartbeat,
        attempts: nonNegative(candidate.attempts, PUSH_TASK_MAX_ATTEMPTS),
        enqueuedAt: nonNegative(candidate.enqueuedAt, 0),
        failedAt: nonNegative(candidate.failedAt, 0),
      })
    }
  }
  if (Array.isArray(raw.report)) {
    for (const item of raw.report.slice(-REPORT_LOG_LIMIT)) {
      if (typeof item !== 'object' || item === null) continue
      const candidate = item as Record<string, unknown>
      const kind = candidate.kind === 'task' ? 'task' : 'batch'
      const state2 = candidate.state === 'failed' || candidate.state === 'retried' ? candidate.state : undefined
      const entry: ReportEntry = {
        id: typeof candidate.id === 'string' && candidate.id !== '' ? candidate.id : randomUUID(),
        time: nonNegative(candidate.time, 0),
        kind,
        count: nonNegative(candidate.count, 1),
        ok: candidate.ok === true,
      }
      if (state2 !== undefined) entry.state = state2
      if (typeof candidate.error === 'string') entry.error = candidate.error
      if (typeof candidate.detail === 'string' && candidate.detail !== '') entry.detail = candidate.detail
      if (typeof candidate.taskId === 'string') entry.taskId = candidate.taskId
      state.report.push(entry)
    }
  }
  return state
}

export type {
  FailedPushTask,
  Heartbeat,
  HeartbeatCategory,
  HeartbeatEntityType,
  HeartbeatEngine,
  PendingHeartbeatEntry,
  PendingHeartbeatState,
  ReportEntry,
} from './types'
