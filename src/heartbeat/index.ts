/*
 * 心跳上报引擎(占位)
 * 作者: JularDepick
 *
 * 初始化阶段仅声明结构与能力边界,功能实现留待后续会话按 AGENTS.md 指示进行。
 */

import { NotImplementedError } from '../errors'
import type { Heartbeat, HeartbeatEngine } from './types'

export class HeartbeatEngineImpl implements HeartbeatEngine {
  async send(_heartbeat: Heartbeat): Promise<void> {
    throw new NotImplementedError('心跳单条上报')
  }

  async sendBatch(_heartbeats: Heartbeat[]): Promise<void> {
    throw new NotImplementedError('心跳批量上报')
  }

  async flushOfflineQueue(): Promise<void> {
    throw new NotImplementedError('离线队列补报')
  }
}

export type { Heartbeat, HeartbeatCategory, HeartbeatEntityType, HeartbeatEngine } from './types'