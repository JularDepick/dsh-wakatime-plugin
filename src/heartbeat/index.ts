/*
 * 心跳上报引擎实现
 * 作者: JularDepick
 *
 * 防抖:同实体在心跳间隔窗口内跳过;上报失败(含网络错误)进入
 * 内存离线队列(上限 OFFLINE_QUEUE_LIMIT,溢出丢最旧),由外部定时
 * 调用 flushOfflineQueue 补报;429/5xx 由 HTTP 层指数退避重试。
 */

import { BULK_HEARTBEAT_LIMIT, HEARTBEATS_BULK_PATH, HEARTBEATS_PATH, OFFLINE_QUEUE_LIMIT } from '../constants'
import { NotAuthenticatedError } from '../errors'
import type { HttpClient } from '../http'
import type { Heartbeat, HeartbeatEngine } from './types'

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
  /* 同实体防抖窗口(秒) */
  heartbeatInterval: number
  /* 是否携带 Token 用量字段 */
  includeTokens: boolean
  /* 是否携带提示词长度字段 */
  includePrompts: boolean
  logger?: EngineLogger
}

/* 离线队列条目:携带发送失败原因与入队时间 */
interface QueuedHeartbeat {
  heartbeat: Heartbeat
  enqueuedAt: number
}

export class HeartbeatEngineImpl implements HeartbeatEngine {
  private readonly http: HttpClient
  private readonly tokenProvider: TokenProvider
  private readonly options: HeartbeatEngineOptions
  /* 同实体最近成功上报时刻(Unix 毫秒) */
  private readonly lastSent = new Map<string, number>()
  /* 离线队列 */
  private readonly queue: QueuedHeartbeat[] = []

  constructor(http: HttpClient, tokenProvider: TokenProvider, options: HeartbeatEngineOptions) {
    this.http = http
    this.tokenProvider = tokenProvider
    this.options = options
  }

  async send(heartbeat: Heartbeat): Promise<void> {
    if (!this.options.enabled) return
    /* 同实体防抖:窗口内重复心跳直接跳过 */
    const now = Date.now()
    const last = this.lastSent.get(heartbeat.entity)
    if (last !== undefined && now - last < this.options.heartbeatInterval * 1000) {
      this.log('info', `[wakatime] 心跳被防抖跳过: ${heartbeat.entity}`)
      return
    }
    /* 乐观标记:发送前登记,避免并发同实体重复发送 */
    this.lastSent.set(heartbeat.entity, now)
    const prepared = this.prepare(heartbeat)
    try {
      await this.deliver([prepared])
    } catch (error) {
      /* 未认证心跳不积压:登录后自然恢复 */
      if (error instanceof NotAuthenticatedError) {
        this.log('info', '[wakatime] 未认证,心跳丢弃')
        return
      }
      this.enqueue(prepared, (error as Error).message)
    }
  }

  async sendBatch(heartbeats: Heartbeat[]): Promise<void> {
    if (!this.options.enabled) return
    const prepared = heartbeats.map((item) => this.prepare(item))
    for (let index = 0; index < prepared.length; index += BULK_HEARTBEAT_LIMIT) {
      const chunk = prepared.slice(index, index + BULK_HEARTBEAT_LIMIT)
      try {
        await this.deliver(chunk)
        for (const item of chunk) this.lastSent.set(item.entity, Date.now())
      } catch (error) {
        if (error instanceof NotAuthenticatedError) continue
        for (const item of chunk) this.enqueue(item, (error as Error).message)
      }
    }
  }

  async flushOfflineQueue(): Promise<void> {
    if (!this.options.enabled) return
    if (this.queue.length === 0) return
    /* 逐条出队补报:补报绕过防抖 */
    const pending = this.queue.splice(0, this.queue.length)
    for (const entry of pending) {
      try {
        await this.deliver([entry.heartbeat])
        this.lastSent.set(entry.heartbeat.entity, Date.now())
      } catch (error) {
        /* 未认证时丢弃补报,其余仍失败则重新入队(可能已满,超限丢最旧) */
        if (error instanceof NotAuthenticatedError) continue
        this.enqueue(entry.heartbeat, '补报仍失败')
      }
    }
  }

  /* 上报一条或多条:单条走 heartbeats,多条走 bulk */
  private async deliver(heartbeats: Heartbeat[]): Promise<void> {
    const token = await this.tokenProvider()
    if (heartbeats.length === 1) {
      await this.http.request(HEARTBEATS_PATH, {
        method: 'POST',
        body: heartbeats[0],
        bearer: token,
      })
    } else {
      await this.http.request(HEARTBEATS_BULK_PATH, {
        method: 'POST',
        body: heartbeats,
        bearer: token,
      })
    }
  }

  /* 按配置裁剪可选字段,并补默认值 */
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
      is_write: heartbeat.is_write,
      ai_session: heartbeat.ai_session,
    }
    if (this.options.includeTokens) {
      copy.ai_input_tokens = heartbeat.ai_input_tokens
      copy.ai_output_tokens = heartbeat.ai_output_tokens
    }
    if (this.options.includePrompts) {
      copy.ai_prompt_length = heartbeat.ai_prompt_length
    }
    copy.ai_line_changes = heartbeat.ai_line_changes
    return copy
  }

  /* 入队:超限丢最旧 */
  private enqueue(heartbeat: Heartbeat, reason: string): void {
    this.queue.push({ heartbeat, enqueuedAt: Date.now() })
    if (this.queue.length > OFFLINE_QUEUE_LIMIT) {
      this.queue.shift()
      this.log('warn', '[wakatime] 离线队列已满,丢弃最旧心跳')
    }
    this.log('warn', `[wakatime] 心跳入队待补报(${reason}): ${heartbeat.entity}`)
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.logger?.[level]?.(message)
  }
}

export type { Heartbeat, HeartbeatCategory, HeartbeatEntityType, HeartbeatEngine } from './types'