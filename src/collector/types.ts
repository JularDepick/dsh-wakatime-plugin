/*
 * 会话事件采集面类型定义
 * 作者: JularDepick
 */

import type { HeartbeatEngine } from '../heartbeat'
import type { ProjectDetector } from '../project'
import type { StatsTracker } from '../stats'
import type { EngineLogger } from '../heartbeat'

export interface CollectorOptions {
  heartbeat: HeartbeatEngine
  stats: StatsTracker
  project: ProjectDetector
  logger?: EngineLogger
}