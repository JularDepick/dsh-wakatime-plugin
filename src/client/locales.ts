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
  | 'status.slotWrite'
  | 'status.slotRead'
  | 'status.slotMissing'
  | 'status.sameAccountTitle'
  | 'status.sameAccountDetail'
  | 'status.sameAccountDifferentTitle'
  | 'credential.title'
  | 'credential.fromEnv'
  | 'credential.save'
  | 'credential.placeholderApiKey'
  | 'credential.placeholderOauth'
  | 'credential.slotWrite'
  | 'credential.slotRead'
  | 'credential.hintSameAccount'
  | 'credential.hintApiKeyPage'
  | 'credential.hintOauthPage'
  | 'credential.updatedAt'
  | 'credential.replaced'
  | 'credential.clear'
  | 'credential.clearConfirm'
  | 'credential.clearFailed'
  | 'credential.cleared'
  | 'credential.added'
  | 'credential.partial'
  | 'credential.errEmpty'
  | 'credential.errClientSecret'
  | 'credential.errApiKeyFormat'
  | 'credential.errOauthFormat'
  | 'credential.errUnknownFormat'
  | 'credential.errWrongSlot'
  | 'credential.errInvalid'
  | 'credential.errEnvLocked'
  | 'credential.errWriteScope'
  | 'credential.errNetwork'
  | 'credential.errDifferentAccount'
  | 'credential.accountUnknown'
  | 'credential.saveFailed'
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
  | 'logs.errPayload'
  | 'logs.errRateLimit'
  | 'status.rejectedShort'
  | 'status.rejectedTitle'
  | 'status.rejectedDetail'
  | 'status.queuedDetail'
  | 'logs.retryUnavailable'
  | 'logs.retryBusy'
  | 'logs.retryFailed'
  | 'logs.legacyHint'
  | 'logs.legacyMigrating'
  | 'logs.legacyDone'
  | 'logs.legacyFailed'
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
  | 'config.saveFailed'
  | 'action.refresh'
  | 'state.loading'
  | 'state.loadFailed'

type WakatimeDict = Record<WakatimeKey, string>

export const zh: WakatimeDict = {
  'tab.label': 'WakaTime',
  'status.configured': '凭证已配置',
  'status.notConfigured': '凭证未配置完整',
  'status.account': '当前账号',
  'status.loggedInAs': '已登录: {name}',
  'status.slotWrite': '写入槽',
  'status.slotRead': '读取槽',
  'status.slotMissing': '未配置',
  'status.sameAccountTitle': '两槽尚未确认是同一个账号',
  'status.sameAccountDetail': '写入槽与读取槽必须属于同一个 WakaTime 用户; 重新保存任一槽时会再次取证',
  'status.sameAccountDifferentTitle': '两槽不属于同一个账号, 上报已暂停',
  'credential.title': '凭证',
  'credential.fromEnv': '由环境变量提供',
  'credential.save': '保存',
  'credential.placeholderApiKey': '粘贴 WakaTime API Key…',
  'credential.placeholderOauth': '粘贴 OAuth 访问令牌…',
  'credential.slotWrite': '写入槽: API Key(用于上报心跳)',
  'credential.slotRead': '读取槽: OAuth 令牌(用于账号与战绩)',
  'credential.hintSameAccount': '两槽必须属于同一个 WakaTime 用户, 保存时会自动取证',
  'credential.hintApiKeyPage': 'https://wakatime.com/settings/api-key',
  'credential.hintOauthPage': 'https://wakatime.com/oauth',
  'credential.updatedAt': '更新时间',
  'credential.replaced': '已更换凭证',
  'credential.clear': '清除凭证',
  'credential.clearConfirm': '确认清除?',
  'credential.clearFailed': '清除凭证失败, 请稍后重试',
  'credential.cleared': '已清除凭证, 本地战绩保留',
  'credential.added': '已保存凭证',
  'credential.partial': '另一槽尚未配置, 上报仍暂停',
  'credential.errEmpty': '凭证不能为空',
  'credential.errClientSecret': '这是 OAuth 应用密钥(client secret), 两槽都不能用',
  'credential.errApiKeyFormat': 'API Key 形态不符: 应为 waka_ 加 36 位 UUID, 共 41 字符',
  'credential.errOauthFormat': 'OAuth 令牌形态不符: 应以 waka_tok_ 开头且长度完整',
  'credential.errUnknownFormat': '无法识别的凭证格式',
  'credential.errWrongSlot': '凭证类型与槽位不符: 写入槽填 API Key, 读取槽填 OAuth 令牌',
  'credential.errInvalid': '凭证无效或验证失败',
  'credential.errEnvLocked': '该槽凭证由环境变量提供, 其优先级高于本地保存; 请先移除对应环境变量再重启 dsh',
  'credential.errWriteScope': '该 API Key 被服务端拒绝, 无法写入心跳; 请确认复制的是完整密钥',
  'credential.errNetwork': '验证凭证时网络异常, 请检查网络后重试',
  'credential.errDifferentAccount': '两槽不属于同一个 WakaTime 用户, 已拒绝保存',
  'credential.accountUnknown': '未知',
  'credential.saveFailed': '保存凭证失败',
  'stats.title': 'Agent 协作战绩',
  'stats.promptChars': '提示词字符总量',
  'stats.promptEstimate': '≈ {n} token',
  'stats.tokenPerSecond': '{n} token/s',
  'stats.thinking': '模型思考总时长',
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
  'logs.errPayload': '上报被服务端拒绝(载荷或端点不被接受)',
  'logs.errRateLimit': '被 WakaTime 限流, 该批已进入失败列表, 可在失败行手动重试',
  'status.rejectedShort': '上报被拒',
  'status.rejectedTitle': '心跳上报被服务端拒绝',
  'status.rejectedDetail': '原因: {reason}',
  'status.queuedDetail': '当前积压 {n} 条, 修好凭证后会自动续传',
  'logs.retryUnavailable': '该失败任务已不在待重试列表, 可能在其它进程或已被重试',
  'logs.retryBusy': '已放回队列, 但本轮推送正忙, 稍后会自动重试',
  'logs.retryFailed': '重试失败',
  'logs.legacyHint': '存在旧版数据, 点击迁移',
  'logs.legacyMigrating': '迁移中…',
  'logs.legacyDone': '旧版数据已迁移',
  'logs.legacyFailed': '迁移失败, 请稍后重试',
  'logs.action': '操作',
  'config.title': '配置',
  'config.open': '配置',
  'config.collapse': '收起配置',
  'config.enabled': '启用上报(关闭后新心跳直接丢弃)',
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
  'status.configured': 'Credentials configured',
  'status.notConfigured': 'Credential setup incomplete',
  'status.account': 'Current account',
  'status.loggedInAs': 'Logged in as {name}',
  'status.slotWrite': 'Write slot',
  'status.slotRead': 'Read slot',
  'status.slotMissing': 'Not configured',
  'status.sameAccountTitle': 'The two slots are not confirmed as the same account',
  'status.sameAccountDetail': 'The write slot and the read slot must belong to the same WakaTime user; saving either slot verifies it again',
  'status.sameAccountDifferentTitle': 'The two slots belong to different accounts, reporting is paused',
  'credential.title': 'Credentials',
  'credential.fromEnv': 'Provided by environment',
  'credential.save': 'Save',
  'credential.placeholderApiKey': 'Paste your WakaTime API key…',
  'credential.placeholderOauth': 'Paste your OAuth access token…',
  'credential.slotWrite': 'Write slot: API key (used to report heartbeats)',
  'credential.slotRead': 'Read slot: OAuth token (used for account and stats)',
  'credential.hintSameAccount': 'Both slots must belong to the same WakaTime user; saving verifies it automatically',
  'credential.hintApiKeyPage': 'https://wakatime.com/settings/api-key',
  'credential.hintOauthPage': 'https://wakatime.com/oauth',
  'credential.updatedAt': 'Updated at',
  'credential.replaced': 'Credential replaced',
  'credential.clear': 'Clear credentials',
  'credential.clearConfirm': 'Confirm clear?',
  'credential.clearFailed': 'Failed to clear the credentials, please retry',
  'credential.cleared': 'Credentials cleared; local stats are kept',
  'credential.added': 'Credential saved',
  'credential.partial': 'The other slot is still empty, reporting stays paused',
  'credential.errEmpty': 'The credential must not be empty',
  'credential.errClientSecret': 'This is an OAuth client secret and cannot be used in either slot',
  'credential.errApiKeyFormat': 'Malformed API key: expected waka_ plus a 36 character UUID, 41 characters in total',
  'credential.errOauthFormat': 'Malformed OAuth token: it must start with waka_tok_ and have full length',
  'credential.errUnknownFormat': 'Unrecognized credential format',
  'credential.errWrongSlot': 'Wrong credential type for this slot: API key for the write slot, OAuth token for the read slot',
  'credential.errInvalid': 'Credential invalid or verification failed',
  'credential.errEnvLocked': 'This slot is supplied by an environment variable and takes precedence over the saved credential; remove the variable and restart dsh',
  'credential.errWriteScope': 'The API key was rejected and cannot write heartbeats; make sure the whole key was copied',
  'credential.errNetwork': 'Network error while verifying the credential, please retry',
  'credential.errDifferentAccount': 'The two slots belong to different WakaTime users, so the save was rejected',
  'credential.accountUnknown': 'Unknown',
  'credential.saveFailed': 'Failed to save the credential',
  'stats.title': 'Agent collaboration battle stats',
  'stats.promptChars': 'Prompt characters',
  'stats.promptEstimate': '≈ {n} tokens',
  'stats.tokenPerSecond': '{n} token/s',
  'stats.thinking': 'Model thinking time',
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
  'logs.errPayload': 'Rejected by the server (payload or endpoint not accepted)',
  'logs.errRateLimit': 'Rate limited by WakaTime; this batch moved to the failed list and can be retried manually',
  'status.rejectedShort': 'Push rejected',
  'status.rejectedTitle': 'Heartbeat pushes are rejected by the server',
  'status.rejectedDetail': 'Reason: {reason}',
  'status.queuedDetail': '{n} heartbeats are queued and will be pushed once the credential is fixed',
  'logs.retryUnavailable': 'That failed task is no longer pending, it may belong to another process or was already retried',
  'logs.retryBusy': 'Queued again, but the current push round is busy; it will be retried automatically',
  'logs.retryFailed': 'Retry failed',
  'logs.legacyHint': 'Legacy data found, click to migrate',
  'logs.legacyMigrating': 'Migrating…',
  'logs.legacyDone': 'Legacy data migrated',
  'logs.legacyFailed': 'Migration failed, please retry later',
  'logs.action': 'Action',
  'config.title': 'Configuration',
  'config.open': 'Settings',
  'config.collapse': 'Hide settings',
  'config.enabled': 'Enable reporting (new heartbeats are dropped when off)',
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
