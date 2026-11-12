/*
 * 会话事件采集面实现
 * 作者: JularDepick
 *
 * 监听 session/event:
 * - user/message:记录提示词长度与 Token 估算(计入会话战绩)
 * - step/start + assistant/message(携带计时流 stream):fold 每步思考时长
 *   (步骤开始 → 首个输出 token)
 * - assistant/message:以 AI 编码类别入队主心跳(携带 Token 用量与提示词字符增量),
 *   并结算该步思考时长
 * - tool/call:以调试类别入队轻量心跳
 * 心跳一律入队本地缓冲,由定时器批量上报(不事件即发)。
 * 每项数据都经 readers.ts 读取:官方能力优先,自实现兜底(见该文件说明)。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { AI_SESSION_GLOBAL_ID, HEARTBEAT_CATEGORY_AI, HEARTBEAT_CATEGORY_TOOL, PROMPT_TOKEN_ESTIMATE_DIVISOR, STEP_TIMING_LIMIT, STEP_TIMING_MAX_AGE_MS } from '../constants'
import type { Heartbeat } from '../heartbeat'
import { machineName, userAgent } from '../useragent'
import { readFirstTokenTime, readPromptLength, readUsage } from './readers'
import type { CollectorOptions } from './types'

/* 提示词 Token 估算:字符数 ÷ 系数(官方无 tokenizer 与估算能力,恒为自实现口径) */
function estimateTokens(chars: number): number {
  return Math.round(chars / PROMPT_TOKEN_ESTIMATE_DIVISOR)
}

/* 一步的思考计时:步骤开始时刻(首 token 时刻改由 assistant/message
   的计时流 stream 读取,见 assistantStreamFirstTokenTime) */
interface StepTiming {
  stepStartTime: number | null
}

/* 会话 id + turn/step 组合键 */
function stepKey(sessionId: string, turn: number, step: number): string {
  return `${sessionId}\u0000${turn}\u0000${step}`
}

/* 是否为真人提示词: 官方消息来源可合并扩展, 未知来源按用户消息处理(不丢真实提示词) */
function isUserAuthored(message: { source?: { kind?: unknown } }): boolean {
  const kind = message.source?.kind
  return kind === undefined || kind === 'user'
}

export class SessionEventCollector {
  private readonly options: CollectorOptions
  /* 各会话最近一次提示词长度(字符):供战绩累计口径使用 */
  private readonly promptLengths = new Map<string, number>()
  /* 各会话待上报的提示词字符数:官方 ai_prompt_length 的口径是"自上次心跳以来新增的字符数",
     故一个 turn 的多条 assistant 心跳只在首条携带一次增量,避免同一提示词被重复累加 */
  private readonly pendingPromptChars = new Map<string, number>()
  /* 各会话进行中的步骤计时 */
  private readonly stepTimings = new Map<string, StepTiming>()

  constructor(options: CollectorOptions) {
    this.options = options
  }

  /* 会话级映射上限:长会话累计不会无限增长(与步骤计时同一上限,超限淘汰最旧) */
  private trimSessions(map: Map<string, number>): void {
    while (map.size > STEP_TIMING_LIMIT) {
      const oldest = map.keys().next().value
      if (oldest === undefined) return
      map.delete(oldest)
    }
  }

  /* 注册事件监听;卸载时由框架自动移除 */
  attach(ctx: Context): void {
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.handle(session, event)
    })
  }

  private handle(session: Session, event: SessionEvent): void {
    /* 采集面不能把异常抛回宿主的 session/event 分发链:
       旧格式恢复或第三方扩展事件都可能让读取器抛错, 一条坏事件不该中断其它监听者 */
    try {
      this.dispatch(session, event)
    } catch (error) {
      this.options.logger?.warn?.('[wakatime] failed to handle session event: ' + String(error))
    }
  }

  private dispatch(session: Session, event: SessionEvent): void {
    switch (event.type) {
      case 'user/message': {
        /* 只统计真人提示词: user/message 同样承载 agent 注入的上下文(文件变更通知,
           子目录 AGENTS.md, skill 内容, cron 通知), 官方以 source.kind 区分,
           全算会让提示词字符与 Token 估算整体虚高 */
        if (!isUserAuthored(event.data)) break
        /* user/message 的 data 即 UserMessage 本体(经官方消息投影读取) */
        const promptLength = readPromptLength(session, event)
        this.promptLengths.set(session.id, promptLength)
        this.options.stats.recordUserMessage(session.id, promptLength, estimateTokens(promptLength))
        /* 增量登记:由随后的首条 assistant 心跳带走(被中断的 turn 顺延到下一次心跳) */
        this.pendingPromptChars.set(session.id, (this.pendingPromptChars.get(session.id) ?? 0) + promptLength)
        this.trimSessions(this.promptLengths)
        this.trimSessions(this.pendingPromptChars)
        break
      }
      case 'step/start': {
        /* 打开该步计时:步骤开始时刻 */
        this.stepTimings.set(stepKey(session.id, event.data.turn, event.data.step), {
          stepStartTime: event.time,
        })
        /* 步骤被中断(无 assistant/message 结算)时不会自行清理: 先按龄淘汰已经不可能再结算的旧计时,
           再按上限淘汰最旧的; 直接按上限淘汰会把仍在进行中的步骤算掉, 思考时长静默丢失 */
        if (this.stepTimings.size > STEP_TIMING_LIMIT) {
          const now = Date.now()
          for (const [key, timing] of this.stepTimings) {
            const startedAt = timing.stepStartTime
            if (startedAt !== null && now - startedAt > STEP_TIMING_MAX_AGE_MS) this.stepTimings.delete(key)
          }
          while (this.stepTimings.size > STEP_TIMING_LIMIT) {
            const oldest = this.stepTimings.keys().next().value
            if (oldest === undefined) break
            this.stepTimings.delete(oldest)
          }
        }
        break
      }
      case 'assistant/message': {
        const usage = readUsage(event)
        const promptLength = this.promptLengths.get(session.id) ?? 0
        this.options.stats.recordAssistant(session.id, usage, promptLength)
        /* 结算该步思考时长(首 token − 步骤开始):0.1.5 起 assistant/chunk
           事件移除,assistant/message 自带计时流 stream,首个输出 token 时刻
           经 readers 读取(官方读取器优先,自实现兜底) */
        const key = stepKey(session.id, event.data.turn, event.data.step)
        const timing = this.stepTimings.get(key)
        this.stepTimings.delete(key)
        const firstTokenTime = readFirstTokenTime(event.data.stream)
        if (timing?.stepStartTime != null && firstTokenTime != null) {
          this.options.stats.recordThinking(session.id, firstTokenTime - timing.stepStartTime)
        }
        /* 项目与分支采样基准:会话工作目录(缺省回退宿主进程 cwd) */
        const project = this.options.project.detect(session.header.cwd)
        const heartbeat: Heartbeat = {
          entity: session.id,
          type: 'app',
          /* 官方字段是整数 UNIX 秒: 小数秒既可能被服务端拒绝, 又让同秒同身份归并的键永不相等 */
          time: Math.floor(event.time / 1000),
          category: HEARTBEAT_CATEGORY_AI,
          project: project.project,
          branch: project.branch,
          ai_session: AI_SESSION_GLOBAL_ID,
          machine_name: machineName(),
          user_agent: userAgent(),
        }
        if (usage) {
          heartbeat.ai_input_tokens = usage.inputTokens
          heartbeat.ai_output_tokens = usage.outputTokens
          /* 缓存命中 TOKEN(输入侧命中提示词缓存的量):用官方统计字段名上报;
             官方计数字段互斥,inputTokens 本身不含缓存命中量 */
          heartbeat.ai_cached_input_tokens = usage.cacheReadTokens
        }
        /* 提示词字符增量:无新增时不发该字段, 云端 ai_prompt_events_total 也据此计数,
           避免一个 turn 的多条心跳被记成多次提示词 */
        const pendingPromptChars = this.pendingPromptChars.get(session.id) ?? 0
        if (pendingPromptChars > 0) {
          this.pendingPromptChars.delete(session.id)
          heartbeat.ai_prompt_length = pendingPromptChars
        }
        this.options.heartbeat.enqueue(heartbeat)
        break
      }
      case 'tool/call': {
        this.options.stats.recordToolCall(session.id)
        /* 项目与分支采样基准:会话工作目录(缺省回退宿主进程 cwd) */
        const project = this.options.project.detect(session.header.cwd)
        const heartbeat: Heartbeat = {
          entity: `tool:${event.data.name}`,
          type: 'app',
          /* 同上: 取整到秒, 与同账号取证写探测心跳的口径一致 */
          time: Math.floor(event.time / 1000),
          category: HEARTBEAT_CATEGORY_TOOL,
          project: project.project,
          branch: project.branch,
          ai_session: AI_SESSION_GLOBAL_ID,
          machine_name: machineName(),
          user_agent: userAgent(),
        }
        this.options.heartbeat.enqueue(heartbeat)
        break
      }
      default:
        /* 其余事件类型不参与采集 */
        break
    }
  }
}

export type { CollectorOptions } from './types'
