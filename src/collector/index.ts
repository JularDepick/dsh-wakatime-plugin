/*
 * 会话事件采集面实现
 * 作者: JularDepick
 *
 * 监听 session/event:
 * - user/message:记录提示词长度与 Token 估算(计入会话战绩)
 * - step/start + assistant/message(携带计时流 stream):fold 每步思考时长
 *   (步骤开始 → 首个输出 token,经 assistantStreamFirstTokenTime 读取)
 * - assistant/message:以 AI 编码类别入队主心跳(携带 Token 用量与提示词长度),
 *   并结算该步思考时长
 * - tool/call:以调试类别入队轻量心跳
 * 心跳一律入队本地缓冲,由定时器批量上报(不事件即发)。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/assistant-stream'
import { AI_SESSION_GLOBAL_ID, HEARTBEAT_CATEGORY_AI, HEARTBEAT_CATEGORY_TOOL, PROMPT_TOKEN_ESTIMATE_DIVISOR } from '../constants'
import type { Heartbeat } from '../heartbeat'
import type { CollectorOptions } from './types'

/* 计算消息可见文本长度(提示词长度口径:所有 text 块字符数之和) */
function contentLength(content: readonly { type: string }[]): number {
  let total = 0
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      total += String(block.text).length
    }
  }
  return total
}

/* 提示词 Token 估算:字符数 ÷ 系数(无官方 tokenizer 时的近似口径) */
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

export class SessionEventCollector {
  private readonly options: CollectorOptions
  /* 各会话最近一次提示词长度(字符) */
  private readonly promptLengths = new Map<string, number>()
  /* 各会话进行中的步骤计时 */
  private readonly stepTimings = new Map<string, StepTiming>()

  constructor(options: CollectorOptions) {
    this.options = options
  }

  /* 注册事件监听;卸载时由框架自动移除 */
  attach(ctx: Context): void {
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.handle(session, event)
    })
  }

  private handle(session: Session, event: SessionEvent): void {
    switch (event.type) {
      case 'user/message': {
        /* user/message 的 data 即 UserMessage 本体 */
        const promptLength = contentLength(event.data.content)
        this.promptLengths.set(session.id, promptLength)
        this.options.stats.recordUserMessage(session.id, promptLength, estimateTokens(promptLength))
        break
      }
      case 'step/start': {
        /* 打开该步计时:步骤开始时刻 */
        this.stepTimings.set(stepKey(session.id, event.data.turn, event.data.step), {
          stepStartTime: event.time,
        })
        break
      }
      case 'assistant/message': {
        const usage = event.data.usage
        const promptLength = this.promptLengths.get(session.id) ?? 0
        this.options.stats.recordAssistant(session.id, usage, promptLength)
        /* 结算该步思考时长(首 token − 步骤开始):0.1.5 起 assistant/chunk
           事件移除,assistant/message 自带计时流 stream,官方
           assistantStreamFirstTokenTime 读取首个输出 token 时刻 */
        const key = stepKey(session.id, event.data.turn, event.data.step)
        const timing = this.stepTimings.get(key)
        this.stepTimings.delete(key)
        const firstTokenTime = assistantStreamFirstTokenTime(event.data.stream)
        if (timing?.stepStartTime != null && firstTokenTime != null) {
          this.options.stats.recordThinking(session.id, firstTokenTime - timing.stepStartTime)
        }
        const heartbeat: Heartbeat = {
          entity: session.id,
          type: 'app',
          time: event.time / 1000,
          category: HEARTBEAT_CATEGORY_AI,
          project: this.options.project.project(),
          branch: this.options.project.branch(),
          ai_session: AI_SESSION_GLOBAL_ID,
          ai_prompt_length: promptLength,
        }
        if (usage) {
          heartbeat.ai_input_tokens = usage.inputTokens
          heartbeat.ai_output_tokens = usage.outputTokens
        }
        this.options.heartbeat.enqueue(heartbeat)
        break
      }
      case 'tool/call': {
        this.options.stats.recordToolCall(session.id)
        const heartbeat: Heartbeat = {
          entity: `tool:${event.data.name}`,
          type: 'app',
          time: event.time / 1000,
          category: HEARTBEAT_CATEGORY_TOOL,
          project: this.options.project.project(),
          branch: this.options.project.branch(),
          ai_session: AI_SESSION_GLOBAL_ID,
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
