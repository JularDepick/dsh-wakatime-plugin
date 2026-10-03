/*
 * 云端同步模块
 * 作者: JularDepick
 *
 * 已配置 API Key 时,拉取 WakaTime summaries 的 AI 聚合字段
 * (最近 CLOUD_SUMMARY_RANGE),供前端战绩区同步展示云端最新数据;
 * 未配置 Key、网络异常或云端返回异常时静默返回 null,不阻塞插件。
 * 仅做读取式同步,不修改云端数据。
 * 结果在进程内缓存 SYNC_CACHE_TTL_MS:窗口内复用(切换标签页、刷新页面不重复请求云端),
 * 缓存与 API Key 绑定(换 Key 或清除 Key 后自动失效),force 选项用于手动刷新。
 */

import { CLOUD_SUMMARY_RANGE, SUMMARIES_PATH, SYNC_CACHE_TTL_MS } from '../constants'
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

/* 云端同步选项 */
export interface SyncOptions {
  /* 忽略缓存强制刷新(手动同步按钮使用) */
  force?: boolean
}

/* 进程内缓存条目:与产生它的 API Key 绑定,避免换账号后串用旧数据 */
interface SyncCacheEntry {
  apiKey: string
  summary: CloudSummary
}

export class CloudSync {
  private cache: SyncCacheEntry | undefined

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthManager,
  ) {}

  /* 拉取云端 AI 聚合;缓存窗口内直接复用;任何失败(未配置/网络/解析)均返回 null */
  async sync(options: SyncOptions = {}): Promise<CloudSummary | null> {
    let apiKey: string
    try {
      apiKey = await this.auth.getApiKey()
    } catch (error) {
      /* 未配置 Key 与网络/云端异常同等待遇:静默失败 */
      if (error instanceof NotAuthenticatedError) return null
      return null
    }
    const cached = this.cache
    if (
      cached !== undefined
      && cached.apiKey === apiKey
      && options.force !== true
      && Date.now() - cached.summary.syncedAt < SYNC_CACHE_TTL_MS
    ) {
      return cached.summary
    }
    try {
      const data = await this.http.request<SummariesResponse>(
        `${SUMMARIES_PATH}?range=${CLOUD_SUMMARY_RANGE}`,
        { method: 'GET', basicAuth: basicAuthOf(apiKey), noRetry: true },
      )
      const totals = data?.data ?? []
      const sum = (pick: (grand: GrandTotal) => number | null | undefined): number =>
        totals.reduce((acc, item) => acc + Math.max(0, pick(item?.grand_total ?? {}) ?? 0), 0)
      const summary: CloudSummary = {
        syncedAt: Date.now(),
        inputTokens: sum((g) => g.ai_input_tokens),
        outputTokens: sum((g) => g.ai_output_tokens),
        promptChars: sum((g) => g.ai_prompt_length_sum),
        sessions: sum((g) => g.ai_sessions),
        promptEvents: sum((g) => g.ai_prompt_events_total),
      }
      this.cache = { apiKey, summary }
      return summary
    } catch {
      /* 网络/云端异常:保留既有缓存供窗口内继续展示,本次返回失败 */
      return null
    }
  }
}