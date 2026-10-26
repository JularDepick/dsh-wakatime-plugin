/*
 * 本地数据存储类型定义
 * 作者: JularDepick
 *
 * 0.4.0 起全插件只有一份本地数据: 战绩累计、云端快照、待发送队列、
 * 失败任务与上报记录, 与凭证无关(更换凭证不影响本地数据).
 */

import type { PendingHeartbeatState } from '../heartbeat'
import type { StatsTotals } from '../stats'
import type { CloudSummary } from '../sync'

/* 本地数据文件结构 */
export interface StoreFile {
  /* 结构版本(迁移判定用) */
  version: number
  /* 最后更新时刻(Unix 毫秒) */
  updatedAt: number
  /* 本地战绩累计量 */
  stats: StatsTotals
  /* 云端快照(summaries AI 聚合);未同步过为 null */
  cloud: CloudSummary | null
  /* 待发送队列、失败任务与上报记录 */
  pending: PendingHeartbeatState
}
