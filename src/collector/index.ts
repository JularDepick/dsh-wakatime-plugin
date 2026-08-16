/*
 * 会话事件采集面实现
 * 作者: JularDepick
 *
 * 监听 session/event:
 * - user/message:记录最近提示词长度(计入会话战绩)
 * - assistant/message:以 AI 编码类别上报主心跳,携带 Token 用量与提示词长度
 * - tool/call:以调试类别上报轻量心跳
 * 心跳发送为 fire-and-forget,失败由心跳引擎进入离线队列。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { HEARTBEAT_CATEGORY_AI, HEARTBEAT_CATEGORY_TOOL } from '../constants'
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

export class SessionEventCollector {
  private readonly options: CollectorOptions
  /* 各会话最近一次提示词长度 */
  private readonly promptLengths = new Map<string, number>()

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
        this.options.stats.recordUserMessage(session.id, promptLength)
        break
      }
      case 'assistant/message': {
        const usage = event.data.usage
        const promptLength = this.promptLengths.get(session.id) ?? 0
        this.options.stats.recordAssistant(session.id, usage, promptLength)
        const heartbeat: Heartbeat = {
          entity: session.id,
          type: 'app',
          time: event.time / 1000,
          category: HEARTBEAT_CATEGORY_AI,
          project: this.options.project.project(),
          branch: this.options.project.branch(),
          ai_session: session.id,
          ai_prompt_length: promptLength,
        }
        if (usage) {
          heartbeat.ai_input_tokens = usage.inputTokens
          heartbeat.ai_output_tokens = usage.outputTokens
        }
        void this.options.heartbeat.send(heartbeat)
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
          ai_session: session.id,
        }
        void this.options.heartbeat.send(heartbeat)
        break
      }
      default:
        /* 其余事件类型不参与采集 */
        break
    }
  }
}

export type { CollectorOptions } from './types'