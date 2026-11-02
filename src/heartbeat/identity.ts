/*
 * 待发送队列条目身份
 * 作者: JularDepick
 *
 * 身份键由心跳自身的字段拼成(time + entity + type + category),在队列内唯一,
 * 用于跨进程合并与启动载入时判定"同一条心跳"。
 * 单独成文件的原因: 心跳层与本地存储层都要用它, 放在任一侧都会形成循环依赖。
 */

import type { PendingHeartbeatEntry } from './types'

/* 队列条目标识: 心跳自身身份(时间 + 实体 + 类型 + 类别)在队列内唯一;
   同一秒内同一实体可能既发 AI 心跳又发工具心跳(类别不同), 键里不分类别会误判为同一条.
   跨进程合并与载入去重都用它, 改动会影响已落盘数据的判重口径 */
export function heartbeatKeyOf(entry: PendingHeartbeatEntry): string {
  const category = entry.heartbeat.category ?? ''
  return `${entry.heartbeat.time}|${entry.heartbeat.entity}|${entry.heartbeat.type}|${category}`
}

/* 入队合并用的键: 在身份键之上再加项目与分支.
   工具心跳的实体是工具名(不带会话), 多个会话在同一毫秒调用同名工具时身份键相同,
   只按身份键合并会把后一条的归属项目丢掉, 故合并判定比跨进程身份更严 */
export function heartbeatMergeKeyOf(entry: PendingHeartbeatEntry): string {
  const project = entry.heartbeat.project ?? ''
  const branch = entry.heartbeat.branch ?? ''
  return `${heartbeatKeyOf(entry)}|${project}|${branch}`
}
