/*
 * 会话数据读取(官方能力优先,自实现兜底)
 * 作者: JularDepick
 *
 * 采集面用到的每项数据都先走 dsh 0.2.0-rc.2 官方已有的读取能力:官方读取器随宿主
 * 升级同步维护,口径与宿主内部实现一致;官方读取器抛错或取不到值时,回退到本文件
 * 的自实现扫描(自实现方法保留不删除,仅作兜底,不再作为主路径):
 * - 首个输出 token 时刻: 官方 assistantStreamFirstTokenTime → 自实现按计时流打包
 *   规则(time0 + dt 前缀和)还原
 * - Token 用量: 官方 assistant/message.usage 字段 → 官方 lastAssistantStreamChunk
 *   (stream,'usage') → 自实现扫描原始 chunk 记录
 * - 提示词长度: 官方 session.deriveEventMessage(event)(含插件注册的消息投影)
 *   → 官方模块函数 deriveEventMessage(event) → 自实现直接读 event.data.content
 */

import type { AssistantStreamRecord, Message, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { assistantStreamFirstTokenTime, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'

/* 消息可见文本长度(提示词长度口径:所有 text 块字符数之和):
   自实现兜底口径,官方无对应工具函数 */
function contentTextLength(content: readonly { type: string }[]): number {
  let total = 0
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      total += String(block.text).length
    }
  }
  return total
}

/* 提示词长度:官方消息投影优先(会话实例方法,含插件注册的消息投影),
   其次官方模块函数(不含投影),最后自实现直接读事件内容 */
export function readPromptLength(session: Session, event: SessionEvent<'user/message'>): number {
  try {
    const projected = session.deriveEventMessage(event)
    if (projected !== null) return contentTextLength(projected.content)
  } catch {
    /* 官方投影在事件异常或投影缺失时可能抛错:降级下一层 */
  }
  try {
    const derived: Message | null = deriveEventMessage(event)
    if (derived !== null) return contentTextLength(derived.content)
  } catch {
    /* 同上 */
  }
  return contentTextLength(event.data.content)
}

/* Token 用量:官方事件字段(适配器上报的权威口径,官方文档明确无独立 usage 事件)
   优先,其次官方计时流读取器,最后自实现扫描计时流里的原始 usage 分片 */
export function readUsage(event: SessionEvent<'assistant/message'>): TokenUsage | undefined {
  if (event.data.usage !== undefined) return event.data.usage
  try {
    const fromStream = lastAssistantStreamChunk(event.data.stream, 'usage')
    if (fromStream !== undefined) return fromStream.usage
  } catch {
    /* 官方读取器对异常记录抛错:降级自实现 */
  }
  return readUsageFallback(event.data.stream)
}

/* 自实现兜底:直接扫描原始 chunk 记录,取最后一个 usage 分片 */
function readUsageFallback(stream: readonly AssistantStreamRecord[]): TokenUsage | undefined {
  let usage: TokenUsage | undefined
  for (const record of stream) {
    if (record.type === 'chunk' && record.chunk.type === 'usage') usage = record.chunk.usage
  }
  return usage
}

/* 首个输出 token 时刻:官方读取器优先,自实现扫描兜底 */
export function readFirstTokenTime(stream: readonly AssistantStreamRecord[]): number | undefined {
  try {
    const time = assistantStreamFirstTokenTime(stream)
    if (time !== undefined) return time
  } catch {
    /* 官方读取器校验记录失败时抛错:降级自实现 */
  }
  return firstTokenTimeFallback(stream)
}

/* 自实现兜底:按计时流打包规则还原首个 token 成员时刻.
   刻意不复用官方 isTokenDelta:兜底路径必须独立于可能失败的官方读取器 */
function firstTokenTimeFallback(stream: readonly AssistantStreamRecord[]): number | undefined {
  for (const record of stream) {
    if (record.type === 'chunk') {
      if (isTokenDeltaFallback(record.chunk)) return record.time
      continue
    }
    /* 带名字的 tool-call 打包段从其首成员起算(与官方口径一致) */
    if (record.type === 'tool-call-chunks' && record.name !== undefined) return record.time0
    const fragments = record.type === 'tool-call-chunks' ? record.args : record.texts
    let time = record.time0
    for (let index = 0; index < fragments.length; index += 1) {
      if (index > 0) time += record.dt[index - 1] ?? 0
      const fragment = fragments[index]
      if (fragment === undefined) continue
      if (fragment !== '') return time
    }
  }
  return undefined
}

/* 自实现兜底:判定单个分片是否承载首个输出 token(口径与官方 isTokenDelta 对齐:
   非空文本/推理片段,或带名字、非空参数的 tool-call 片段) */
function isTokenDeltaFallback(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}
