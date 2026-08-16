/*
 * 会话战绩统计
 * 作者: JularDepick
 *
 * 按 DSH 会话聚合上报维度:心跳条数、工具调用、提示词长度与 Token 用量。
 */

export interface SessionStats {
  sessionId: string
  /* 心跳上报条数 */
  heartbeats: number
  /* 工具调用次数 */
  toolCalls: number
  /* 用户消息条数 */
  userMessages: number
  /* 累计输入 Token */
  inputTokens: number
  /* 累计输出 Token */
  outputTokens: number
  /* 累计缓存读取 Token */
  cacheReadTokens: number
  /* 累计缓存写入 Token */
  cacheWriteTokens: number
  /* 累计推理 Token */
  reasoningTokens: number
  /* 最近一次提示词长度(字符) */
  lastPromptLength: number
}

export interface UsageLike {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export class StatsTracker {
  private readonly sessions = new Map<string, SessionStats>()

  /* 获取会话统计,不存在时惰性创建 */
  get(sessionId: string): SessionStats {
    let stats = this.sessions.get(sessionId)
    if (!stats) {
      stats = {
        sessionId,
        heartbeats: 0,
        toolCalls: 0,
        userMessages: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        lastPromptLength: 0,
      }
      this.sessions.set(sessionId, stats)
    }
    return stats
  }

  /* 记录一次 assistant 心跳 */
  recordAssistant(sessionId: string, usage: UsageLike | undefined, promptLength: number): SessionStats {
    const stats = this.get(sessionId)
    stats.heartbeats++
    if (usage) {
      stats.inputTokens += usage.inputTokens
      stats.outputTokens += usage.outputTokens
      stats.cacheReadTokens += usage.cacheReadTokens ?? 0
      stats.cacheWriteTokens += usage.cacheWriteTokens ?? 0
      stats.reasoningTokens += usage.reasoningTokens ?? 0
    }
    stats.lastPromptLength = promptLength
    return stats
  }

  /* 记录一次工具调用 */
  recordToolCall(sessionId: string): SessionStats {
    const stats = this.get(sessionId)
    stats.toolCalls++
    return stats
  }

  /* 记录一次用户消息 */
  recordUserMessage(sessionId: string, promptLength: number): SessionStats {
    const stats = this.get(sessionId)
    stats.userMessages++
    stats.lastPromptLength = promptLength
    return stats
  }

  /* 聚合全部会话(战绩工具汇总用) */
  aggregate(): SessionStats {
    const merged: SessionStats = {
      sessionId: '(aggregate)',
      heartbeats: 0,
      toolCalls: 0,
      userMessages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      lastPromptLength: 0,
    }
    for (const stats of this.sessions.values()) {
      merged.heartbeats += stats.heartbeats
      merged.toolCalls += stats.toolCalls
      merged.userMessages += stats.userMessages
      merged.inputTokens += stats.inputTokens
      merged.outputTokens += stats.outputTokens
      merged.cacheReadTokens += stats.cacheReadTokens
      merged.cacheWriteTokens += stats.cacheWriteTokens
      merged.reasoningTokens += stats.reasoningTokens
    }
    return merged
  }
}