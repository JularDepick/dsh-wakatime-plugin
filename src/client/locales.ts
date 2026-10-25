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
  | 'status.loginSuccess'
  | 'credential.title'
  | 'credential.kind'
  | 'credential.kindApiKey'
  | 'credential.kindOauth'
  | 'credential.saveApiKey'
  | 'credential.saveOauth'
  | 'credential.clear'
  | 'credential.clearConfirm'
  | 'credential.keyConfigured'
  | 'credential.keyMissing'
  | 'credential.oauthConfigured'
  | 'credential.oauthMissing'
  | 'credential.overwrite'
  | 'credential.hintApiKey'
  | 'credential.hintOauth'
  | 'credential.placeholderApiKey'
  | 'credential.placeholderOauth'
  | 'credential.invalidApiKey'
  | 'credential.invalidOauth'
  | 'stats.title'
  | 'stats.promptChars'
  | 'stats.promptEstimate'
  | 'stats.thinking'
  | 'stats.outputTokens'
  | 'stats.apiEffective'
  | 'stats.avgOutputSpeed'
  | 'stats.colMetric'
  | 'stats.colValue'
  | 'stats.colNote'
  | 'stats.noteThinking'
  | 'stats.noteOutput'
  | 'stats.noteApiEffective'
  | 'stats.noteAvgOutputSpeed'
  | 'stats.cacheHitTokens'
  | 'stats.noteCacheHitTokens'
  | 'stats.scope'
  | 'stats.scopeAll'
  | 'stats.scopeCurrent'
  | 'cloud.sync'
  | 'cloud.syncing'
  | 'cloud.syncedAt'
  | 'cloud.never'
  | 'cloud.failed'
  | 'cloud.range'
  | 'logs.title'
  | 'logs.expand'
  | 'logs.collapse'
  | 'logs.empty'
  | 'logs.count'
  | 'logs.time'
  | 'logs.records'
  | 'logs.result'
  | 'logs.detail'
  | 'logs.success'
  | 'logs.failed'
  | 'logs.retried'
  | 'logs.retry'
  | 'logs.action'
  | 'logs.errNotConfigured'
  | 'config.title'
  | 'config.open'
  | 'config.collapse'
  | 'config.enabled'
  | 'config.reportInterval'
  | 'config.reportEnabled'
  | 'config.includeTokens'
  | 'config.includePrompts'
  | 'config.debug'
  | 'config.tableBorders'
  | 'config.statsScope'
  | 'config.statsScopeAll'
  | 'config.statsScopeCurrent'
  | 'config.digitGrouping'
  | 'config.digitGroupingThousand'
  | 'config.digitGroupingMyriad'
  | 'buckets.title'
  | 'buckets.hint'
  | 'buckets.empty'
  | 'buckets.current'
  | 'buckets.stale'
  | 'buckets.recent'
  | 'buckets.updatedAt'
  | 'buckets.remove'
  | 'buckets.removeConfirm'
  | 'buckets.removeFailed'
  | 'buckets.errInUse'
  | 'buckets.errRecent'
  | 'buckets.errMissing'
  | 'config.saving'
  | 'config.instantHint'
  | 'config.saveFailed'
  | 'action.refresh'
  | 'state.loading'
  | 'state.loadFailed'

type WakatimeDict = Record<WakatimeKey, string>

export const zh: WakatimeDict = {
  'tab.label': 'WakaTime',
  'status.configured': '已配置凭证',
  'status.notConfigured': '未配置凭证',
  'status.account': '当前账号',
  'status.loginSuccess': '登录成功, ',
  'credential.title': '凭证',
  'credential.kind': '凭证类型',
  'credential.kindApiKey': '插件密钥',
  'credential.kindOauth': 'OAuth 令牌',
  'credential.saveApiKey': '保存插件密钥',
  'credential.saveOauth': '保存 OAuth 令牌',
  'credential.clear': '清除凭证',
  'credential.clearConfirm': '确认清除凭证?',
  'credential.keyConfigured': '插件密钥已配置',
  'credential.keyMissing': '插件密钥未配置',
  'credential.oauthConfigured': 'OAuth 令牌已配置',
  'credential.oauthMissing': 'OAuth 令牌未配置',
  'credential.overwrite': '仅覆盖、不可查看。',
  'credential.hintApiKey': '在 wakatime.com/settings/api-key 生成; WakaTime 自 2026-11-01 起只允许插件用它提交活动。',
  'credential.hintOauth': '在 wakatime.com/settings 生成个人令牌; 勾选 write_heartbeats、read_summaries、email 三个 scope。',
  'credential.placeholderApiKey': '粘贴新的插件密钥…',
  'credential.placeholderOauth': '粘贴新的 OAuth 访问令牌…',
  'credential.invalidApiKey': '插件密钥无效或验证失败',
  'credential.invalidOauth': 'OAuth 令牌无效或验证失败',
  'stats.title': 'Agent 协作战绩',
  'stats.promptChars': '提示词字符总量',
  'stats.promptEstimate': '≈ {n} token',
  'stats.thinking': '模型思考总时长',
  'stats.outputTokens': '输出TOKEN总量',
  'stats.apiEffective': '有效TOKEN消耗量',
  'stats.avgOutputSpeed': '平均输出速度',
  'stats.colMetric': '指标名称',
  'stats.colValue': '指标数值',
  'stats.colNote': '备注',
  'stats.noteThinking': '步骤开始至首TOKEN输出',
  'stats.noteOutput': '官方 ai_output_tokens',
  'stats.noteApiEffective': '输入输出总量,缓存命中不计入',
  'stats.noteAvgOutputSpeed': 'TOKEN输出速度',
  'stats.cacheHitTokens': '缓存命中TOKEN总量',
  'stats.noteCacheHitTokens': '输入侧命中提示词缓存的 TOKEN',
  'stats.scope': '战绩显示策略',
  'stats.scopeAll': '全部密钥战绩',
  'stats.scopeCurrent': '当前密钥战绩',
  'cloud.sync': '同步',
  'cloud.syncing': '同步中…',
  'cloud.syncedAt': '同步时间',
  'cloud.never': '尚未同步',
  'cloud.failed': '同步失败',
  'cloud.range': '近 7 天',
  'logs.title': '上报记录',
  'logs.expand': '展开上报记录',
  'logs.collapse': '收起上报记录',
  'logs.empty': '暂无上报记录',
  'logs.count': '条',
  'logs.time': '时间',
  'logs.records': '条数',
  'logs.result': '结果',
  'logs.detail': '详情',
  'logs.success': '成功',
  'logs.failed': '失败',
  'logs.retried': '已重试',
  'logs.retry': '重试',
  'logs.action': '操作',
  'logs.errNotConfigured': '未配置 API Key',
  'config.title': '配置',
  'config.open': '配置',
  'config.collapse': '收起配置',
  'config.enabled': '启用上报',
  'config.reportInterval': '上报间隔(秒)',
  'config.reportEnabled': '开启定时上报',
  'config.includeTokens': '上报 Token 用量',
  'config.includePrompts': '上报提示词长度',
  'config.debug': '调试日志',
  'config.tableBorders': '显示表格边框',
  'config.statsScope': '战绩显示策略',
  'config.statsScopeAll': '全部密钥战绩',
  'config.statsScopeCurrent': '当前密钥战绩',
  'config.digitGrouping': '数位分隔符',
  'config.digitGroupingThousand': '千位',
  'config.digitGroupingMyriad': '万位',
  'buckets.title': 'API Key 缓存',
  'buckets.hint': '每个 API Key 各自一份本地缓存(战绩累计、云端快照与待发送心跳);30 天未登录的缓存可手动移除',
  'buckets.empty': '暂无 API Key 缓存',
  'buckets.current': '当前密钥',
  'buckets.stale': '30 天未登录',
  'buckets.recent': '使用中',
  'buckets.updatedAt': '最后更新',
  'buckets.remove': '移除缓存',
  'buckets.removeConfirm': '确认移除',
  'buckets.removeFailed': '移除缓存失败',
  'buckets.errInUse': '当前密钥的缓存不可移除,请先切换或清除 API Key',
  'buckets.errRecent': '该密钥 30 天内仍在使用,暂不可移除',
  'buckets.errMissing': '该缓存已不存在,已刷新列表',
  'config.saving': '保存中…',
  'config.instantHint': '修改立即生效',
  'config.saveFailed': '保存失败',
  'action.refresh': '刷新',
  'state.loading': '加载中…',
  'state.loadFailed': '加载失败(Web 接口仅在 web profile 提供)',
}

export const en: WakatimeDict = {
  'tab.label': 'WakaTime',
  'status.configured': 'Credential configured',
  'status.notConfigured': 'Credential not configured',
  'status.account': 'Current account',
  'status.loginSuccess': 'Logged in as ',
  'credential.title': 'Credential',
  'credential.kind': 'Credential type',
  'credential.kindApiKey': 'Plugin key',
  'credential.kindOauth': 'OAuth token',
  'credential.saveApiKey': 'Save plugin key',
  'credential.saveOauth': 'Save OAuth token',
  'credential.clear': 'Clear credential',
  'credential.clearConfirm': 'Confirm clear?',
  'credential.keyConfigured': 'Plugin key configured',
  'credential.keyMissing': 'Plugin key not configured',
  'credential.oauthConfigured': 'OAuth token configured',
  'credential.oauthMissing': 'OAuth token not configured',
  'credential.overwrite': 'Overwrite only, never shown.',
  'credential.hintApiKey': 'Generate one at wakatime.com/settings/api-key; since 2026-11-01 WakaTime only lets plugins submit activity with it.',
  'credential.hintOauth': 'Create a personal token at wakatime.com/settings; select the write_heartbeats, read_summaries and email scopes.',
  'credential.placeholderApiKey': 'Paste a new plugin key…',
  'credential.placeholderOauth': 'Paste a new OAuth access token…',
  'credential.invalidApiKey': 'Plugin key invalid or verification failed',
  'credential.invalidOauth': 'OAuth token invalid or verification failed',
  'stats.title': 'Agent collaboration battle stats',
  'stats.promptChars': 'Prompt characters',
  'stats.promptEstimate': '≈ {n} tokens',
  'stats.thinking': 'Model thinking time',
  'stats.outputTokens': 'Output TOKEN total',
  'stats.apiEffective': 'Effective TOKEN usage',
  'stats.avgOutputSpeed': 'Average output speed',
  'stats.colMetric': 'Metric name',
  'stats.colValue': 'Metric value',
  'stats.colNote': 'Note',
  'stats.noteThinking': 'Step start to first TOKEN output',
  'stats.noteOutput': 'Official ai_output_tokens',
  'stats.noteApiEffective': 'Input and output total; cache hits excluded',
  'stats.noteAvgOutputSpeed': 'TOKEN output speed',
  'stats.cacheHitTokens': 'Cache hit TOKEN total',
  'stats.noteCacheHitTokens': 'Input TOKENs served from the prompt cache',
  'stats.scope': 'Stats display scope',
  'stats.scopeAll': 'All API keys',
  'stats.scopeCurrent': 'Current API key',
  'cloud.sync': 'Sync',
  'cloud.syncing': 'Syncing…',
  'cloud.syncedAt': 'Synced at',
  'cloud.never': 'Not synced yet',
  'cloud.failed': 'Sync failed',
  'cloud.range': 'Last 7 days',
  'logs.title': 'Report log',
  'logs.expand': 'Expand report log',
  'logs.collapse': 'Collapse report log',
  'logs.empty': 'No report records yet',
  'logs.count': 'items',
  'logs.time': 'Time',
  'logs.records': 'Records',
  'logs.result': 'Result',
  'logs.detail': 'Detail',
  'logs.success': 'OK',
  'logs.failed': 'Failed',
  'logs.retried': 'Retried',
  'logs.retry': 'Retry',
  'logs.action': 'Action',
  'logs.errNotConfigured': 'API key not configured',
  'config.title': 'Configuration',
  'config.open': 'Settings',
  'config.collapse': 'Hide settings',
  'config.enabled': 'Enable reporting',
  'config.reportInterval': 'Report interval (seconds)',
  'config.reportEnabled': 'Enable scheduled reporting',
  'config.includeTokens': 'Report token usage',
  'config.includePrompts': 'Report prompt length',
  'config.debug': 'Debug logging',
  'config.tableBorders': 'Show table borders',
  'config.statsScope': 'Stats display scope',
  'config.statsScopeAll': 'All API keys',
  'config.statsScopeCurrent': 'Current API key',
  'config.digitGrouping': 'Digit grouping',
  'config.digitGroupingThousand': 'Thousands',
  'config.digitGroupingMyriad': 'Ten thousands',
  'buckets.title': 'API key caches',
  'buckets.hint': 'Each API key keeps its own local cache (stats totals, cloud snapshot, pending heartbeats); caches unused for 30 days can be removed manually',
  'buckets.empty': 'No API key cache yet',
  'buckets.current': 'Current key',
  'buckets.stale': 'Unused for 30 days',
  'buckets.recent': 'In use',
  'buckets.updatedAt': 'Last updated',
  'buckets.remove': 'Remove cache',
  'buckets.removeConfirm': 'Confirm removal',
  'buckets.removeFailed': 'Failed to remove cache',
  'buckets.errInUse': 'The current key cache cannot be removed; switch or clear the API key first',
  'buckets.errRecent': 'This key was still in use within the last 30 days, so it cannot be removed yet',
  'buckets.errMissing': 'That cache no longer exists; the list has been refreshed',
  'config.saving': 'Saving…',
  'config.instantHint': 'Changes apply immediately',
  'config.saveFailed': 'Save failed',
  'action.refresh': 'Refresh',
  'state.loading': 'Loading…',
  'state.loadFailed': 'Load failed (Web API is only available in the web profile)',
}
