/*
 * WakaTime 浏览器端字典
 * 作者: JularDepick
 *
 * 语言跟随 dsh web 的 UI 语言切换(web locale id: zh / en),
 * 不单独提供语种选择;字典经 ctx.locale 注册,切换自动生效。
 */

/** 本插件字典键集合(zh/en 两套完整覆盖) */
export type WakatimeKey =
  | 'tab.label'
  | 'status.configured'
  | 'status.notConfigured'
  | 'status.account'
  | 'apikey.overwrite'
  | 'apikey.save'
  | 'apikey.saved'
  | 'apikey.invalid'
  | 'apikey.placeholder'
  | 'apikey.hint'
  | 'stats.title'
  | 'stats.promptTokens'
  | 'stats.thinking'
  | 'stats.outputTokens'
  | 'stats.apiEffective'
  | 'stats.heartbeats'
  | 'stats.toolCalls'
  | 'logs.title'
  | 'logs.expand'
  | 'logs.collapse'
  | 'logs.empty'
  | 'logs.count'
  | 'logs.success'
  | 'logs.failed'
  | 'config.title'
  | 'config.enabled'
  | 'config.reportInterval'
  | 'config.reportEnabled'
  | 'config.includeTokens'
  | 'config.includePrompts'
  | 'config.debug'
  | 'config.locale'
  | 'config.save'
  | 'config.saving'
  | 'config.saved'
  | 'config.saveFailed'
  | 'action.refresh'
  | 'state.loading'
  | 'state.loadFailed'

type WakatimeDict = Record<WakatimeKey, string>

export const zh: WakatimeDict = {
  'tab.label': 'WakaTime',
  'status.configured': '已配置 API Key',
  'status.notConfigured': '未配置 API Key',
  'status.account': '当前账号',
  'apikey.overwrite': '覆盖写入 API Key(仅覆盖,不可查看)',
  'apikey.save': '保存 API Key',
  'apikey.saved': 'API Key 已保存',
  'apikey.invalid': 'API Key 无效或验证失败',
  'apikey.placeholder': '粘贴新的 API Key…',
  'apikey.hint': '在 wakatime.com/settings/api-key 生成。保存后仅可覆盖、不可查看。',
  'stats.title': 'Agent 协作战绩',
  'stats.promptTokens': '提示词总量',
  'stats.thinking': 'LLM 思考总时长',
  'stats.outputTokens': '输出 TOKEN 总量',
  'stats.apiEffective': 'API 有效 TOKEN 消耗',
  'stats.heartbeats': '心跳上报',
  'stats.toolCalls': '工具调用',
  'logs.title': '上报记录',
  'logs.expand': '展开上报记录',
  'logs.collapse': '收起上报记录',
  'logs.empty': '暂无上报记录',
  'logs.count': '条',
  'logs.success': '成功',
  'logs.failed': '失败',
  'config.title': '配置',
  'config.enabled': '启用上报',
  'config.reportInterval': '上报间隔(秒)',
  'config.reportEnabled': '开启定时上报',
  'config.includeTokens': '上报 Token 用量',
  'config.includePrompts': '上报提示词长度',
  'config.debug': '调试日志',
  'config.locale': '界面语言',
  'config.save': '保存配置',
  'config.saving': '保存中…',
  'config.saved': '配置已保存',
  'config.saveFailed': '保存失败',
  'action.refresh': '刷新',
  'state.loading': '加载中…',
  'state.loadFailed': '加载失败(Web 接口仅在 web profile 提供)',
}

export const en: WakatimeDict = {
  'tab.label': 'WakaTime',
  'status.configured': 'API key configured',
  'status.notConfigured': 'API key not configured',
  'status.account': 'Current account',
  'apikey.overwrite': 'Overwrite API key (overwrite only, never shown)',
  'apikey.save': 'Save API key',
  'apikey.saved': 'API key saved',
  'apikey.invalid': 'API key invalid or verification failed',
  'apikey.placeholder': 'Paste a new API key…',
  'apikey.hint': 'Generate one at wakatime.com/settings/api-key. After saving it can only be overwritten, never viewed.',
  'stats.title': 'Agent collaboration battle stats',
  'stats.promptTokens': 'Prompt tokens',
  'stats.thinking': 'LLM thinking time',
  'stats.outputTokens': 'Output tokens',
  'stats.apiEffective': 'API effective token usage',
  'stats.heartbeats': 'Heartbeats',
  'stats.toolCalls': 'Tool calls',
  'logs.title': 'Report log',
  'logs.expand': 'Expand report log',
  'logs.collapse': 'Collapse report log',
  'logs.empty': 'No report records yet',
  'logs.count': 'items',
  'logs.success': 'OK',
  'logs.failed': 'Failed',
  'config.title': 'Configuration',
  'config.enabled': 'Enable reporting',
  'config.reportInterval': 'Report interval (seconds)',
  'config.reportEnabled': 'Enable scheduled reporting',
  'config.includeTokens': 'Report token usage',
  'config.includePrompts': 'Report prompt length',
  'config.debug': 'Debug logging',
  'config.locale': 'Language',
  'config.save': 'Save config',
  'config.saving': 'Saving…',
  'config.saved': 'Config saved',
  'config.saveFailed': 'Save failed',
  'action.refresh': 'Refresh',
  'state.loading': 'Loading…',
  'state.loadFailed': 'Load failed (Web API is only available in the web profile)',
}
