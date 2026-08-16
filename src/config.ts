/*
 * 插件配置定义与校验
 * 作者: JularDepick
 */

import Schema from '@deepseek-ai/schemastery'

/* 配置项:用户可在 cordis.yml 的 config 中覆盖,schema 提供默认值 */
export interface Config {
  /* 是否启用数据上报 */
  enabled: boolean
  /* 界面语言,取值如 zh-CN / en-US */
  locale: string
  /* WakaTime OAuth App 客户端标识(也可经 WAKATIME_CLIENT_ID 注入) */
  clientId: string
  /* WakaTime OAuth App 客户端密钥(也可经 WAKATIME_CLIENT_SECRET 注入) */
  clientSecret: string
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
  clientId: Schema.string().default(''),
  clientSecret: Schema.string().default(''),
  heartbeatInterval: Schema.number().default(120),
  includeTokens: Schema.boolean().default(true),
  includePrompts: Schema.boolean().default(true),
  debug: Schema.boolean().default(false),
})