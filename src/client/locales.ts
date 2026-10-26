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
  | 'credential.count'
  | 'credential.activeType'
  | 'credential.fromEnv'
  | 'credential.add'
  | 'credential.save'
  | 'credential.placeholder'
  | 'credential.hintApiKey'
  | 'credential.hintOauth'
  | 'credential.overwrite'
  | 'credential.clear'
  | 'credential.clearConfirm'
  | 'credential.current'
  | 'credential.switch'
  | 'credential.remove'
  | 'credential.removeConfirm'
  | 'credential.typeApiKey'
  | 'credential.typeOauth'
  | 'credential.errEmpty'
  | 'credential.errClientSecret'
  | 'credential.errUnknownFormat'
  | 'credential.errInvalid'
  | 'credential.errNotFound'
  | 'credential.errActive'
  | 'stats.title'
  | 'stats.promptChars'
  | 'stats.promptEstimate'
  | 'stats.tokenPerSecond'
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
  | 'config.groupReporting'
  | 'config.groupPayload'
  | 'config.groupDisplay'
  | 'config.groupDiagnostics'
  | 'credential.hintOauthScopes'
  | 'credential.accountUnknown'
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
  'credential.count': '已存凭证',
  'credential.activeType': '当前凭证',
  'credential.fromEnv': '由环境变量提供',
  'credential.add': '新增凭证',
  'credential.save': '保存凭证',
  'credential.placeholder': '粘贴插件密钥或 OAuth 访问令牌…',
  'credential.hintApiKey': '插件密钥: 登录后访问 wakatime.com/settings/api-key 获取。',
  'credential.hintOauth': 'OAuth 令牌: 登录后访问 wakatime.com/oauth 获取, 自用无需创建应用。',
  'credential.hintOauthScopes': '需要自定义 scope 或供他人使用时, 在 wakatime.com/apps 创建应用, 授权时用 scope 参数申请 write_heartbeats、read_summaries、email。',
  'credential.accountUnknown': '未知',
  'credential.overwrite': '类型按前缀自动识别(无需选择), 仅覆盖、不可查看。',
  'credential.clear': '清除全部凭证',
  'credential.clearConfirm': '确认清除全部?',
  'credential.current': '使用中',
  'credential.switch': '切换',
  'credential.remove': '移除凭证',
  'credential.removeConfirm': '确认移除?',
  'credential.typeApiKey': '插件密钥',
  'credential.typeOauth': 'OAuth 令牌',
  'credential.errEmpty': '凭证不能为空',
  'credential.errClientSecret': '这是 OAuth 应用密钥(client secret), 不能当凭证使用; 访问令牌请到 https://wakatime.com/oauth 获取',
  'credential.errUnknownFormat': '无法识别的凭证格式: 插件密钥以 waka_ 开头, OAuth 令牌以 waka_tok_ 开头',
  'credential.errInvalid': '凭证无效或验证失败',
  'credential.errNotFound': '凭证不存在',
  'credential.errActive': '该凭证正在使用, 请先切换到其它凭证',
  'stats.title': 'Agent 协作战绩',
  'stats.promptChars': '提示词字符总量',
  'stats.promptEstimate': '≈ {n} token',
  'stats.thinking': '模型思考总时长',
  'stats.tokenPerSecond': '{n} token/s',
  'stats.outputTokens': '输出 TOKEN 总量',
  'stats.apiEffective': '有效 TOKEN 消耗量',
  'stats.avgOutputSpeed': '平均输出速度',
  'stats.colMetric': '指标名称',
  'stats.colValue': '指标数值',
  'stats.colNote': '备注',
  'stats.noteThinking': '步骤开始至首 TOKEN 输出',
  'stats.noteOutput': '官方 ai_output_tokens',
  'stats.noteApiEffective': '输入输出总量,缓存命中不计入',
  'stats.noteAvgOutputSpeed': 'TOKEN 输出速度',
  'stats.cacheHitTokens': '缓存命中 TOKEN 总量',
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
  'config.statsScopeAll': '全部凭证战绩',
  'config.statsScopeCurrent': '当前凭证战绩',
  'config.digitGrouping': '数位分隔符',
  'config.digitGroupingThousand': '千位',
  'config.digitGroupingMyriad': '万位',
  'buckets.title': '凭证缓存',
  'buckets.hint': '每份凭证各自一份本地缓存(战绩累计、云端快照与待发送心跳);非当前凭证可切换或移除',
  'buckets.empty': '暂无凭证缓存',
  'buckets.stale': '30 天未更新',
  'buckets.recent': '近期更新',
  'buckets.updatedAt': '最后更新',
  'buckets.remove': '移除缓存',
  'buckets.removeConfirm': '确认移除',
  'buckets.removeFailed': '移除缓存失败',
  'buckets.errInUse': '当前凭证的缓存不可移除,请先切换或清除凭证',
  'buckets.errRecent': '该凭证 30 天内仍在使用,暂不可移除',
  'buckets.errMissing': '该缓存已不存在,已刷新列表',
  'config.saving': '保存中…',
  'config.instantHint': '修改立即生效',
  'config.groupReporting': '上报',
  'config.groupPayload': '上报字段',
  'config.groupDisplay': '展示',
  'config.groupDiagnostics': '诊断',
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
  'credential.count': 'Saved credentials',
  'credential.activeType': 'Active credential',
  'credential.fromEnv': 'Provided by environment',
  'credential.add': 'Add credential',
  'credential.save': 'Save credential',
  'credential.placeholder': 'Paste a plugin key or OAuth access token…',
  'credential.hintApiKey': 'Plugin key: open wakatime.com/settings/api-key while signed in.',
  'credential.hintOauth': 'OAuth token: open wakatime.com/oauth while signed in; no app is needed for personal use.',
  'credential.hintOauthScopes': 'To pick custom scopes or act for others, create an app at wakatime.com/apps and request write_heartbeats, read_summaries and email via the scope argument.',
  'credential.accountUnknown': 'Unknown',
  'credential.overwrite': 'Type is detected from the prefix, no selection needed; overwrite only, never shown.',
  'credential.clear': 'Clear all credentials',
  'credential.clearConfirm': 'Confirm clear all?',
  'credential.current': 'In use',
  'credential.switch': 'Switch',
  'credential.remove': 'Remove credential',
  'credential.removeConfirm': 'Confirm remove?',
  'credential.typeApiKey': 'Plugin key',
  'credential.typeOauth': 'OAuth token',
  'credential.errEmpty': 'The credential must not be empty',
  'credential.errClientSecret': 'This is an OAuth client secret and cannot be used as a credential; get an access token at https://wakatime.com/oauth',
  'credential.errUnknownFormat': 'Unrecognized credential format: plugin keys start with waka_, OAuth tokens start with waka_tok_',
  'credential.errInvalid': 'Credential invalid or verification failed',
  'credential.errNotFound': 'Credential not found',
  'credential.errActive': 'This credential is in use; switch to another one first',
  'stats.title': 'Agent collaboration battle stats',
  'stats.promptChars': 'Prompt characters',
  'stats.promptEstimate': '≈ {n} tokens',
  'stats.thinking': 'Model thinking time',
  'stats.tokenPerSecond': '{n} token/s',
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
  'config.statsScopeAll': 'All credentials',
  'config.statsScopeCurrent': 'Current credential',
  'config.digitGrouping': 'Digit grouping',
  'config.digitGroupingThousand': 'Thousands',
  'config.digitGroupingMyriad': 'Ten thousands',
  'buckets.title': 'Credential caches',
  'buckets.hint': 'Each credential keeps its own local cache (stats totals, cloud snapshot, pending heartbeats); a non-active credential can be switched or removed',
  'buckets.empty': 'No credential cache yet',
  'buckets.stale': 'Unused for 30 days',
  'buckets.recent': 'Updated recently',
  'buckets.updatedAt': 'Last updated',
  'buckets.remove': 'Remove cache',
  'buckets.removeConfirm': 'Confirm removal',
  'buckets.removeFailed': 'Failed to remove cache',
  'buckets.errInUse': 'The active credential cache cannot be removed; switch or clear the credential first',
  'buckets.errRecent': 'This credential was still in use within the last 30 days, so it cannot be removed yet',
  'buckets.errMissing': 'That cache no longer exists; the list has been refreshed',
  'config.saving': 'Saving…',
  'config.instantHint': 'Changes apply immediately',
  'config.groupReporting': 'Reporting',
  'config.groupPayload': 'Payload',
  'config.groupDisplay': 'Display',
  'config.groupDiagnostics': 'Diagnostics',
  'config.saveFailed': 'Save failed',
  'action.refresh': 'Refresh',
  'state.loading': 'Loading…',
  'state.loadFailed': 'Load failed (Web API is only available in the web profile)',
}
