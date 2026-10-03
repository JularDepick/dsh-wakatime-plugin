/*
 * 会话战绩统计
 * 作者: JularDepick
 *
 * 按 DSH 会话聚合上报维度:心跳条数、工具调用、提示词长度与 Token 用量;
 * 另累计全局生产力指标:提示词字符总量(官方 ai_prompt_length 口径)、
 * 提示词 Token 估算(本地辅助)、LLM 思考总时长、API 有效 Token 消耗
 * (输入+输出,官方 Heartbeat 仅 ai_input_tokens/ai_output_tokens)。
 * 累计量支持"保留量"基线:本地独有指标(思考时长、提示词 Token 估算)在官方
 * 字段表中没有对应项,无法从云端恢复,故由调用方把上次运行落盘的累计量经
 * seed() 恢复,聚合时与实时会话相加;每次变更经 onChange 通知调用方持久化。
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
  /* 提示词字符总量(官方 ai_prompt_length 口径,与上报一致) */
  promptChars: number
  /* 提示词 Token 估算总量(用户消息字符数 ÷ 估算系数,本地辅助展示) */
  promptTokens: number
  /* LLM 思考总时长(毫秒:步骤开始 → 首个输出 token) */
  thinkingMs: number
}

/* 可持久化的累计量:不含会话 id 与"最近一次提示词长度"这类瞬时值 */
export type StatsTotals = Omit<SessionStats, 'sessionId' | 'lastPromptLength'>

export interface StatsOptions {
  /* 累计量变更回调(供落盘;调用方自行防抖) */
  onChange?: (totals: StatsTotals) => void
}

/* 累计量字段全集(用于归零初始化与外部快照归一化) */
const TOTAL_KEYS: readonly (keyof StatsTotals)[] = [
  'heartbeats',
  'toolCalls',
  'userMessages',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'promptChars',
  'promptTokens',
  'thinkingMs',
]

export function emptyTotals(): StatsTotals {
  return {
    heartbeats: 0,
    toolCalls: 0,
    userMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    promptChars: 0,
    promptTokens: 0,
    thinkingMs: 0,
  }
}

/* 外部快照归一化:只接受有限非负数值,缺失字段按 0(损坏快照不会污染统计) */
export function normalizeTotals(value: unknown): StatsTotals {
  const totals = emptyTotals()
  if (typeof value !== 'object' || value === null) return totals
  for (const key of TOTAL_KEYS) {
    const raw = (value as Record<string, unknown>)[key]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) totals[key] = raw
  }
  return totals
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
  /* 保留量:上次运行落盘的累计量,启动时经 seed() 恢复 */
  private carried: StatsTotals = emptyTotals()

  constructor(private readonly options: StatsOptions = {}) {}

  /* 恢复历史累计量(启动时调用一次;此后与实时会话相加) */
  seed(totals: unknown): void {
    this.carried = normalizeTotals(totals)
  }

  /* 获取会话统计,不存在时惰性创建 */
  get(sessionId: string): SessionStats {
    let stats = this.sessions.get(sessionId)
    if (!stats) {
      stats = {
        sessionId,
        lastPromptLength: 0,
        ...emptyTotals(),
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
    this.notify()
    return stats
  }

  /* 记录一次工具调用 */
  recordToolCall(sessionId: string): SessionStats {
    const stats = this.get(sessionId)
    stats.toolCalls++
    this.notify()
    return stats
  }

  /* 记录一次用户消息:字符长度(官方口径)与 Token 估算(估算系数由常量提供) */
  recordUserMessage(sessionId: string, promptLength: number, promptTokens: number): SessionStats {
    const stats = this.get(sessionId)
    stats.userMessages++
    stats.lastPromptLength = promptLength
    stats.promptChars += promptLength
    stats.promptTokens += promptTokens
    this.notify()
    return stats
  }

  /* 累计一次 LLM 思考时长(毫秒) */
  recordThinking(sessionId: string, durationMs: number): SessionStats {
    const stats = this.get(sessionId)
    if (durationMs > 0) {
      stats.thinkingMs += durationMs
      this.notify()
    }
    return stats
  }

  /* 当前累计量:保留量 + 全部实时会话(持久化与聚合的共同口径) */
  totals(): StatsTotals {
    const merged = { ...this.carried }
    for (const stats of this.sessions.values()) {
      for (const key of TOTAL_KEYS) merged[key] += stats[key]
    }
    return merged
  }

  /* 聚合全部会话(战绩工具/Web 汇总用) */
  aggregate(): SessionStats {
    return {
      sessionId: '(aggregate)',
      lastPromptLength: 0,
      ...this.totals(),
    }
  }

  /* 全部会话统计列表(Web 内部数据;只含实时会话,不含保留量) */
  listSessions(): SessionStats[] {
    return [...this.sessions.values()]
  }

  /* 累计量变更通知(落盘由调用方防抖) */
  private notify(): void {
    this.options.onChange?.(this.totals())
  }
}
