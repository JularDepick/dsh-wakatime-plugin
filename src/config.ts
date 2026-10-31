/*
 * 插件配置定义与校验
 * 作者: JularDepick
 *
 * 凭证不在此配置中,统一经配置管理模块读写(明文不入配置 schema);
 * 这里只承载可公开的运行参数。schema 提供默认值。
 */

import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_REPORT_INTERVAL_SECONDS } from './constants'

/* 数位分隔符:千位(每 3 位一组)/ 万位(每 4 位一组),两者都用英文逗号分隔 */
export type DigitGrouping = 'thousand' | 'myriad'

/* 配置项:用户可在 cordis.yml 的 config 中覆盖,schema 提供默认值 */
export interface Config {
  /* 是否启用数据上报:关闭时心跳直接丢弃(总开关) */
  enabled: boolean
  /* 界面语言,取值如 zh-CN / en-US(host 工具文案;Web UI 语言跟随 dsh web) */
  locale: string
  /* 定时上报间隔(秒):启动加载时上报一次,之后按此间隔循环 */
  reportInterval: number
  /* 是否开启定时上报:仅控制自动推送轮(启动/定时/补推),
     关闭时心跳留在待发送队列,重新开启后继续推送 */
  reportEnabled: boolean
  /* 是否上报 Token 用量 */
  includeTokens: boolean
  /* 是否上报提示词长度 */
  includePrompts: boolean
  /* 调试日志开关 */
  debug: boolean
  /* 战绩表是否显示表格边框(Web 配置页可改,纯展示项,不影响上报) */
  tableBorders: boolean
  /* 数位分隔符:千位(thousand)/ 万位(myriad),纯展示项,不影响上报数据 */
  digitGrouping: DigitGrouping
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
  tableBorders: Schema.boolean().default(true),
  digitGrouping: Schema.union([Schema.const('thousand'), Schema.const('myriad')]).default('thousand'),
})
