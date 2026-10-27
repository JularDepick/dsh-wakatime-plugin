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
  | 'status.loggedInAs'
  | 'credential.title'
  | 'credential.fromEnv'
  | 'credential.add'
  | 'credential.save'
  | 'credential.placeholder'
  | 'credential.hintOauth'
  | 'credential.hintOauthScopes'
  | 'credential.overwrite'
  | 'credential.updatedAt'
  | 'credential.replaced'
  | 'credential.clear'
  | 'credential.clearConfirm'
  | 'credential.clearFailed'
  | 'credential.cleared'
  | 'credential.added'
  | 'credential.errEmpty'
  | 'credential.errClientSecret'
  | 'credential.errApiKey'
  | 'credential.errUnknownFormat'
  | 'credential.errInvalid'
  | 'credential.errEnvLocked'
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
  | 'cloud.sync'
  | 'cloud.syncing'
  | 'cloud.syncedAt'
  | 'cloud.never'
  | 'cloud.failed'
  | 'cloud.errNoCredential'
  | 'cloud.errFailed'
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
  | 'logs.retrying'
  | 'logs.attempts'
  | 'logs.errCredential'
  | 'logs.errNetwork'
  | 'logs.retryUnavailable'
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
  | 'config.digitGrouping'
  | 'config.digitGroupingThousand'
  | 'config.digitGroupingMyriad'
  | 'config.saving'
  | 'config.instantHint'
  | 'config.groupReporting'
  | 'config.groupPayload'
  | 'config.groupDisplay'
  | 'config.groupDiagnostics'
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
  'status.loggedInAs': '已登录: {name}',
  'credential.title': '凭证',
  'credential.fromEnv': '由环境变量提供',
  'credential.add': '保存或更换凭证',
  'credential.save': '保存',
  'credential.placeholder': '粘贴 OAuth 访问令牌…',
  'credential.hintOauth': 'OAuth 令牌: 登录后访问 wakatime.com/oauth 获取, 自用无需创建应用。',
  'credential.hintOauthScopes': '需要自定义 scope 或供他人使用时, 在 wakatime.com/apps 创建应用, 授权时用 scope 参数申请 write_heartbeats、read_summaries、email。',
  'credential.accountUnknown': '未知',
  'credential.overwrite': '只保存 OAuth 访问令牌, 仅覆盖不可查看; 更换凭证后本地战绩保留。',
  'credential.updatedAt': '凭证更新时间',
  'credential.replaced': '凭证已保存',
  'credential.clear': '清除凭证',
  'credential.clearConfirm': '确认清除?',
  'credential.clearFailed': '清除凭证失败, 请稍后重试',
  'credential.cleared': '已清除凭证, 本地战绩保留',
  'credential.added': '已保存凭证',
  'credential.errEmpty': '凭证不能为空',
  'credential.errClientSecret': '这是 OAuth 应用密钥(client secret), 不能当凭证使用; 访问令牌请到 https://wakatime.com/oauth 获取',
  'credential.errApiKey': '插件密钥不再支持, 请改用个人 OAuth 访问令牌(在 https://wakatime.com/oauth 获取)',
  'credential.errUnknownFormat': '无法识别的凭证格式: OAuth 访问令牌以 waka_tok_ 开头且长度完整',
  'credential.errInvalid': '凭证无效或验证失败',
  'credential.errEnvLocked': '环境变量 WAKATIME_OAUTH_TOKEN 生效中, 其优先级高于本地保存; 请先移除该变量再重启 dsh',
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
  'stats.noteApiEffective': '未命中输入 + 缓存读写 + 输出',
  'stats.noteAvgOutputSpeed': 'TOKEN 输出速度',
  'stats.cacheHitTokens': '缓存命中 TOKEN 总量',
  'stats.noteCacheHitTokens': '输入侧命中提示词缓存的 TOKEN',
  'cloud.sync': '同步',
  'cloud.syncing': '同步中…',
  'cloud.syncedAt': '同步时间',
  'cloud.never': '尚未同步',
  'cloud.failed': '同步失败',
  'cloud.errNoCredential': '同步失败: 未配置凭证',
  'cloud.errFailed': '同步失败: 网络或服务端异常',
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
  'logs.retrying': '重试中…',
  'logs.attempts': '已尝试 {n} 次',
  'logs.errCredential': '凭证失效或权限不足',
  'logs.errNetwork': '网络或服务端异常',
  'logs.retryUnavailable': '该失败任务已不在待重试列表, 可能在其它进程或已被重试',
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
  'config.digitGrouping': '数位分隔符',
  'config.digitGroupingThousand': '千位',
  'config.digitGroupingMyriad': '万位',
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
  'status.loggedInAs': 'Logged in as {name}',
  'credential.title': 'Credential',
  'credential.fromEnv': 'Provided by environment',
  'credential.add': 'Save or replace credential',
  'credential.save': 'Save',
  'credential.placeholder': 'Paste an OAuth access token…',
  'credential.hintOauth': 'OAuth token: open wakatime.com/oauth while signed in; no app is needed for personal use.',
  'credential.hintOauthScopes': 'To pick custom scopes or act for others, create an app at wakatime.com/apps and request write_heartbeats, read_summaries and email via the scope argument.',
  'credential.accountUnknown': 'Unknown',
  'credential.overwrite': 'OAuth access token only, overwrite-only and never shown; local stats are kept after replacing it.',
  'credential.updatedAt': 'Credential updated at',
  'credential.replaced': 'Credential saved',
  'credential.clear': 'Clear credential',
  'credential.clearConfirm': 'Confirm clear?',
  'credential.clearFailed': 'Failed to clear the credential, please retry',
  'credential.cleared': 'Credential cleared; local stats are kept',
  'credential.added': 'Credential saved',
  'credential.errEmpty': 'The credential must not be empty',
  'credential.errClientSecret': 'This is an OAuth client secret and cannot be used as a credential; get an access token at https://wakatime.com/oauth',
  'credential.errApiKey': 'Plugin keys are no longer supported; use a personal OAuth access token from https://wakatime.com/oauth',
  'credential.errUnknownFormat': 'Unrecognized credential format: OAuth access tokens start with waka_tok_ and have full length',
  'credential.errInvalid': 'Credential invalid or verification failed',
  'credential.errEnvLocked': 'WAKATIME_OAUTH_TOKEN is set and takes precedence over the saved credential; remove it and restart dsh',
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
  'stats.noteApiEffective': 'Uncached input + cache read/write + output',
  'stats.noteAvgOutputSpeed': 'TOKEN output speed',
  'stats.cacheHitTokens': 'Cache hit TOKEN total',
  'stats.noteCacheHitTokens': 'Input TOKENs served from the prompt cache',
  'cloud.sync': 'Sync',
  'cloud.syncing': 'Syncing…',
  'cloud.syncedAt': 'Synced at',
  'cloud.never': 'Not synced yet',
  'cloud.failed': 'Sync failed',
  'cloud.errNoCredential': 'Sync failed: no credential configured',
  'cloud.errFailed': 'Sync failed: network or upstream error',
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
  'logs.retrying': 'Retrying…',
  'logs.attempts': 'tried {n} times',
  'logs.errCredential': 'credential rejected or lacking permission',
  'logs.errNetwork': 'network or upstream error',
  'logs.retryUnavailable': 'That failed task is no longer pending, it may belong to another process or was already retried',
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
  'config.digitGrouping': 'Digit grouping',
  'config.digitGroupingThousand': 'Thousands',
  'config.digitGroupingMyriad': 'Ten thousands',
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
