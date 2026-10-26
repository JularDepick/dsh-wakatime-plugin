/*
 * 分 Key 数据桶类型定义
 * 作者: JularDepick
 */

import type { PendingHeartbeatState } from '../heartbeat'
import type { StatsTotals } from '../stats'
import type { CloudSummary } from '../sync'

/* 未指派桶:未配置 API Key 期间采集的数据落在此桶,由此后首个配置的 Key 认领 */
export const UNASSIGNED_BUCKET = 'unassigned'

/* 单个数据桶:一个 API Key(或未指派桶)的全部本地数据 */
export interface DataBucket {
  /* 最后更新时刻(Unix 毫秒):判定该 Key 是否长期未登录的依据 */
  updatedAt: number
  /* 展示用模糊 API Key(保留首尾各 8 字符,其余 *;旧版桶无此字段,界面回退显示摘要标识) */
  maskedKey?: string
  /* 本地战绩累计量 */
  stats: StatsTotals
  /* 该 Key 的云端快照(summaries AI 聚合);未同步过为 null */
  cloud: CloudSummary | null
  /* 待发送队列、失败任务与上报记录 */
  pending: PendingHeartbeatState
}

/* 数据桶文件结构 */
export interface BucketFile {
  version: number
  buckets: Record<string, DataBucket>
  /* 删除墓碑:桶标识 -> 删除时刻(Unix 毫秒)。多进程合并时墓碑优先, 已删除的桶不会被其它进程复活 */
  tombstones?: Record<string, number>
}
