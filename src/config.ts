/*
 * 插件配置定义与校验
 * 作者: JularDepick
 */

import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_CLIENT_ID, DEFAULT_CALLBACK_PORT, DEFAULT_HEARTBEAT_INTERVAL_SECONDS } from './constants'

/* 配置项:用户可在 cordis.yml 的 config 中覆盖,schema 提供默认值 */
export interface Config {
  /* 是否启用数据上报 */
  enabled: boolean
  /* 界面语言,取值如 zh-CN / en-US */
  locale: string
  /* WakaTime OAuth App 客户端标识(默认使用项目已创建的 App,可经 WAKATIME_CLIENT_ID 覆盖) */
  clientId: string
  /* WakaTime OAuth App 客户端密钥(留空则为 public client 模式;可经 WAKATIME_CLIENT_SECRET 注入) */
  clientSecret: string
  /* OAuth 本地回调端口 */
  callbackPort: number
  /* 心跳上报最小间隔(秒),同实体防抖窗口 */
  heartbeatInterval: number
  /* 是否上报 Token 用量 */
  includeTokens: boolean
  /* 是否上报提示词长度 */
  includePrompts: boolean
  /* 调试日志开关 */
  debug: boolean
}

/* Schemastery 校验器:默认值写入 schema,无效配置在加载期响亮失败 */
export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  locale: Schema.string().default('zh-CN'),
  clientId: Schema.string().default(DEFAULT_CLIENT_ID),
  clientSecret: Schema.string().default(''),
  callbackPort: Schema.number().default(DEFAULT_CALLBACK_PORT),
  heartbeatInterval: Schema.number().default(DEFAULT_HEARTBEAT_INTERVAL_SECONDS),
  includeTokens: Schema.boolean().default(true),
  includePrompts: Schema.boolean().default(true),
  debug: Schema.boolean().default(false),
})