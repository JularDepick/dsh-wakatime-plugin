/*
 * 待发送队列条目身份
 * 作者: JularDepick
 *
 * 身份键由心跳自身的字段拼成(time + entity + type),在队列内唯一,
 * 用于跨进程合并与启动载入时判定"同一条心跳"。
 * 单独成文件的原因: 心跳层与本地存储层都要用它, 放在任一侧都会形成循环依赖。
 */

import type { PendingHeartbeatEntry } from './types'

/* 队列条目标识: 心跳自身身份(时间 + 实体 + 类型)在队列内唯一 */
export function heartbeatKeyOf(entry: PendingHeartbeatEntry): string {
  return `${entry.heartbeat.time}|${entry.heartbeat.entity}|${entry.heartbeat.type}`
}
