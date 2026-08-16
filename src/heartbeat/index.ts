/*
 * 心跳上报引擎实现
 * 作者: JularDepick
 *
 * 定时批量模式:采集面把心跳入队本地缓冲(不立即发送);
 * 定时器(启动时一次 + 每 reportInterval 秒)调用 flushBuffered,
 * 把缓冲内全部心跳批量上报(bulk)并清空。发送失败(网络错误)
 * 进入内存离线队列(上限 OFFLINE_QUEUE_LIMIT,溢出丢最旧),由外部
 * 定时调用 flushOfflineQueue 补报;429/5xx 由 HTTP 层指数退避重试。
 * 未认证(未配置 API Key)时缓冲直接丢弃,配置 Key 后自然恢复。
 */

import { BULK_HEARTBEAT_LIMIT, HEARTBEATS_BULK_PATH, HEARTBEATS_PATH, OFFLINE_QUEUE_LIMIT, REPORT_LOG_LIMIT } from '../constants'
import { NotAuthenticatedError } from '../errors'
import type { HttpClient } from '../http'
import type { Heartbeat, HeartbeatEngine, ReportLogEntry } from './types'

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
}

/* 离线队列条目:携带发送失败原因与入队时间 */
interface QueuedHeartbeat {
  heartbeat: Heartbeat
  enqueuedAt: number
}

export class HeartbeatEngineImpl implements HeartbeatEngine {
  private readonly http: HttpClient
  private readonly tokenProvider: TokenProvider
  /* 可变选项:Web 设置页写入后经 updateOptions 即时生效 */
  private options: HeartbeatEngineOptions
  /* 待上报缓冲(定时批量发送后清空) */
  private readonly buffer: Heartbeat[] = []
  /* 离线队列 */
  private readonly queue: QueuedHeartbeat[] = []
  /* 最近上报记录(调试日志) */
  private readonly logs: ReportLogEntry[] = []

  constructor(http: HttpClient, tokenProvider: TokenProvider, options: HeartbeatEngineOptions) {
    this.http = http
    this.tokenProvider = tokenProvider
    this.options = options
  }

  /* 更新运行选项(enabled/字段裁剪),不替换 logger */
  updateOptions(patch: Partial<HeartbeatEngineOptions>): void {
    this.options = { ...this.options, ...patch }
  }

  /* 入队一条心跳;未启用时直接丢弃 */
  enqueue(heartbeat: Heartbeat): void {
    if (!this.options.enabled) return
    this.buffer.push(this.prepare(heartbeat))
  }

  /* 定时批量上报:发送缓冲内全部心跳并清空;未认证时丢弃缓冲 */
  async flushBuffered(): Promise<void> {
    if (!this.options.enabled) return
    if (this.buffer.length === 0) return
    const pending = this.buffer.splice(0, this.buffer.length)
    try {
      await this.deliver(pending)
      this.recordLog({ time: Date.now(), count: pending.length, ok: true })
      this.log('info', `[wakatime] 定时上报 ${pending.length} 条心跳`)
    } catch (error) {
      /* 未认证:缓冲不积压,登录后自然恢复 */
      if (error instanceof NotAuthenticatedError) {
        this.recordLog({ time: Date.now(), count: pending.length, ok: false, error: '未配置 API Key' })
        this.log('info', '[wakatime] 未认证,心跳丢弃')
        return
      }
      /* 其余失败入离线队列补报 */
      for (const heartbeat of pending) this.enqueueOffline(heartbeat, (error as Error).message)
      this.recordLog({ time: Date.now(), count: pending.length, ok: false, error: (error as Error).message })
    }
  }

  /* 离线队列补报:逐条补报,绕过批量缓冲 */
  async flushOfflineQueue(): Promise<void> {
    if (!this.options.enabled) return
    if (this.queue.length === 0) return
    const pending = this.queue.splice(0, this.queue.length)
    for (const entry of pending) {
      try {
        await this.deliver([entry.heartbeat])
      } catch (error) {
        /* 未认证时丢弃补报,其余仍失败则重新入队(可能已满,超限丢最旧) */
        if (error instanceof NotAuthenticatedError) continue
        this.enqueueOffline(entry.heartbeat, '补报仍失败')
      }
    }
  }

  /* 最近上报记录(调试日志,Web 展示) */
  reportLogs(): readonly ReportLogEntry[] {
    return this.logs
  }

  /* 上报一批:单条走 heartbeats,多条走 bulk */
  private async deliver(heartbeats: Heartbeat[]): Promise<void> {
    const token = await this.tokenProvider()
    if (heartbeats.length === 1) {
      await this.http.request(HEARTBEATS_PATH, {
        method: 'POST',
        body: heartbeats[0],
        basicAuth: token,
      })
    } else {
      for (let index = 0; index < heartbeats.length; index += BULK_HEARTBEAT_LIMIT) {
        const chunk = heartbeats.slice(index, index + BULK_HEARTBEAT_LIMIT)
        await this.http.request(HEARTBEATS_BULK_PATH, {
          method: 'POST',
          body: chunk,
          basicAuth: token,
        })
      }
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
    return copy
  }

  /* 入队离线:超限丢最旧 */
  private enqueueOffline(heartbeat: Heartbeat, reason: string): void {
    this.queue.push({ heartbeat, enqueuedAt: Date.now() })
    if (this.queue.length > OFFLINE_QUEUE_LIMIT) {
      this.queue.shift()
      this.log('warn', '[wakatime] 离线队列已满,丢弃最旧心跳')
    }
    this.log('warn', `[wakatime] 心跳入队待补报(${reason})`)
  }

  private recordLog(entry: ReportLogEntry): void {
    this.logs.push(entry)
    if (this.logs.length > REPORT_LOG_LIMIT) this.logs.shift()
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.logger?.[level]?.(message)
  }
}

export type { Heartbeat, HeartbeatCategory, HeartbeatEntityType, HeartbeatEngine, ReportLogEntry } from './types'
