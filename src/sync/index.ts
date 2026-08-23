/*
 * 云端同步模块
 * 作者: JularDepick
 *
 * 已配置 API Key 时,拉取 WakaTime summaries 的 AI 聚合字段
 * (最近 CLOUD_SUMMARY_RANGE),供前端战绩区同步展示云端最新数据;
 * 未配置 Key、网络异常或云端返回异常时静默返回 null,不阻塞插件。
 * 仅做读取式同步,不修改云端数据。
 */

import { CLOUD_SUMMARY_RANGE, SUMMARIES_PATH } from '../constants'
import { NotAuthenticatedError } from '../errors'
import type { AuthManager } from '../auth'
import type { HttpClient } from '../http'
import { basicAuthOf } from '../auth'

/* 云端 AI 聚合结果(summaries grand_total 的 AI 字段,7 天窗口) */
export interface CloudSummary {
  /* 同步完成时刻(Unix 毫秒) */
  syncedAt: number
  /* 云端累计输入 Token */
  inputTokens: number
  /* 云端累计输出 Token */
  outputTokens: number
  /* 云端累计提示词字符数(ai_prompt_length_sum) */
  promptChars: number
  /* 云端累计 AI 会话数(ai_sessions) */
  sessions: number
  /* 云端累计提示词事件数(ai_prompt_events_total) */
  promptEvents: number
}

/* grand_total 中可用的 AI 字段(其余忽略) */
interface GrandTotal {
  ai_input_tokens?: number | null
  ai_output_tokens?: number | null
  ai_prompt_length_sum?: number | null
  ai_sessions?: number | null
  ai_prompt_events_total?: number | null
}

interface SummariesResponse {
  data?: Array<{ grand_total?: GrandTotal | null } | null>
}

export class CloudSync {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthManager,
  ) {}

  /* 拉取云端 AI 聚合;任何失败(未配置/网络/解析)均返回 null */
  async sync(): Promise<CloudSummary | null> {
    try {
      const apiKey = await this.auth.getApiKey()
      const data = await this.http.request<SummariesResponse>(
        `${SUMMARIES_PATH}?range=${CLOUD_SUMMARY_RANGE}`,
        { method: 'GET', basicAuth: basicAuthOf(apiKey), noRetry: true },
      )
      const totals = data?.data ?? []
      const sum = (pick: (grand: GrandTotal) => number | null | undefined): number =>
        totals.reduce((acc, item) => acc + Math.max(0, pick(item?.grand_total ?? {}) ?? 0), 0)
      return {
        syncedAt: Date.now(),
        inputTokens: sum((g) => g.ai_input_tokens),
        outputTokens: sum((g) => g.ai_output_tokens),
        promptChars: sum((g) => g.ai_prompt_length_sum),
        sessions: sum((g) => g.ai_sessions),
        promptEvents: sum((g) => g.ai_prompt_events_total),
      }
    } catch (error) {
      /* 未配置 Key 与网络/云端异常同等待遇:静默失败 */
      if (error instanceof NotAuthenticatedError) return null
      return null
    }
  }
}