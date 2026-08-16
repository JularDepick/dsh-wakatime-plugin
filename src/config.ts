/*
 * 插件配置定义与校验
 * 作者: JularDepick
 *
 * API Key 属凭证,不在此配置中,统一经小后端(config-manager)管理;
 * 这里只承载可公开的运行参数。schema 提供默认值。
 */

import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_REPORT_INTERVAL_SECONDS } from './constants'

/* 配置项:用户可在 cordis.yml 的 config 中覆盖,schema 提供默认值 */
export interface Config {
  /* 是否启用数据上报 */
  enabled: boolean
  /* 界面语言,取值如 zh-CN / en-US(host 工具文案;Web UI 语言跟随 dsh web) */
  locale: string
  /* 定时上报间隔(秒):启动加载时上报一次,之后按此间隔循环 */
  reportInterval: number
  /* 是否开启定时上报 */
  reportEnabled: boolean
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
  reportInterval: Schema.number().default(DEFAULT_REPORT_INTERVAL_SECONDS),
  reportEnabled: Schema.boolean().default(true),
  includeTokens: Schema.boolean().default(true),
  includePrompts: Schema.boolean().default(true),
  debug: Schema.boolean().default(false),
})
