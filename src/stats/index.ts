/*
 * 会话战绩统计
 * 作者: JularDepick
 *
 * 按 DSH 会话聚合上报维度:心跳条数、工具调用、提示词长度与 Token 用量;
 * 另累计全局生产力指标:提示词 Token 估算总量、LLM 思考总时长、
 * API 有效 Token 消耗(输入+输出+缓存读写)。
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
  /* 提示词 Token 估算总量(用户消息字符数 ÷ 估算系数) */
  promptTokens: number
  /* LLM 思考总时长(毫秒:步骤开始 → 首个输出 token) */
  thinkingMs: number
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
        promptTokens: 0,
        thinkingMs: 0,
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

  /* 记录一次用户消息:字符长度与 Token 估算(估算系数由常量提供) */
  recordUserMessage(sessionId: string, promptLength: number, promptTokens: number): SessionStats {
    const stats = this.get(sessionId)
    stats.userMessages++
    stats.lastPromptLength = promptLength
    stats.promptTokens += promptTokens
    return stats
  }

  /* 累计一次 LLM 思考时长(毫秒) */
  recordThinking(sessionId: string, durationMs: number): SessionStats {
    const stats = this.get(sessionId)
    if (durationMs > 0) stats.thinkingMs += durationMs
    return stats
  }

  /* 聚合全部会话(战绩工具/Web 汇总用) */
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
      promptTokens: 0,
      thinkingMs: 0,
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
      merged.promptTokens += stats.promptTokens
      merged.thinkingMs += stats.thinkingMs
    }
    return merged
  }

  /* 全部会话统计列表(Web 内部数据) */
  listSessions(): SessionStats[] {
    return [...this.sessions.values()]
  }
}
