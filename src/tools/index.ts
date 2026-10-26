/*
 * 插件工具注册
 * 作者: JularDepick
 *
 * 以 dsh 工具形式暴露 WakaTime 命令面:
 * - wakatime_config:查看/覆盖修改插件配置(Agent 可代替用户配置;
 *   API Key 只允许覆盖写入,读取时仅显示是否已配置)
 * - wakatime_logout:清除本地 API Key
 * - wakatime_status:查看认证状态(不回显 Key 明文)
 * - wakatime_stats:查看 Agent 协作战绩
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AuthManager } from '../auth'
import { CredentialInputError } from '../errors'
import type { StatsView } from '../bucket-store/resolve'
import { NotAuthenticatedError } from '../errors'
import { averageOutputSpeed, effectiveTokens, formatThinkingDuration } from '../metrics'
import type { RuntimeConfig } from '../runtime-config'
import { translate } from '../translation'

export interface WakatimeToolsOptions {
  auth: AuthManager
  /* 运行时配置:读取/修改全部配置项 */
  runtimeConfig: RuntimeConfig
  /* 按当前显示策略解析战绩(与 Web 战绩表同源) */
  resolveStats: () => StatsView
}

/* 配置工具可写的键(白名单,与 WebConfigPatch 对齐,不含凭证) */
const CONFIG_KEYS = [
  'enabled', 'locale', 'reportInterval', 'reportEnabled',
  'includeTokens', 'includePrompts', 'debug', 'tableBorders', 'statsScope', 'digitGrouping',
] as const

/* 配置键类型约束 */
const KEY_TYPES: Record<(typeof CONFIG_KEYS)[number], 'boolean' | 'string' | 'number'> = {
  enabled: 'boolean',
  locale: 'string',
  reportInterval: 'number',
  reportEnabled: 'boolean',
  includeTokens: 'boolean',
  includePrompts: 'boolean',
  debug: 'boolean',
  tableBorders: 'boolean',
  statsScope: 'string',
  digitGrouping: 'string',
}

/* 枚举型配置键的合法取值 */
const KEY_VALUES: Partial<Record<(typeof CONFIG_KEYS)[number], readonly string[]>> = {
  statsScope: ['all', 'current'],
  digitGrouping: ['thousand', 'myriad'],
}

export class WakatimeTools {
  private readonly options: WakatimeToolsOptions

  constructor(options: WakatimeToolsOptions) {
    this.options = options
  }

  /* 注册全部工具;卸载时由框架自动清理 */
  register(ctx: Context): void {
    ctx.tools.register(defineTool({
      name: 'wakatime_config',
      description: 'Read or update WakaTime plugin configuration and saved credentials. The credential type is detected from its prefix; plaintext is never read back.',
      parameters: {
        op: {
          type: 'string',
          enum: ['get', 'set', 'list_credentials', 'set_credential', 'switch_credential', 'remove_credential'],
          description: 'get: read config; set: update one config key; list_credentials: list saved credentials; set_credential: save and activate a credential (plugin key or OAuth access token, type auto-detected); switch_credential: activate one by id; remove_credential: delete one by id',
          required: true,
        },
        key: { type: 'string', description: 'Config key for op=set' },
        value: { type: 'json', description: 'Config value for op=set' },
        secret: { type: 'string', description: 'Plugin key or OAuth access token for op=set_credential (overwrite only, never read back)' },
        id: { type: 'string', description: 'Credential id for op=switch_credential or op=remove_credential' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: (args) => this.handleConfig(args),
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_logout',
      description: 'Clear every locally stored WakaTime credential.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => {
        await this.options.auth.clearCredentials()
        return translate('credential.cleared')
      },
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_status',
      description: 'Show the current WakaTime credential configuration status.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => {
        const status = await this.options.auth.getStatus()
        if (!status.configured) return translate('status.notConfigured')
        const lines = [`${translate('status.configured')}`]
        if (status.activeType !== undefined) {
          const label = status.activeType === 'oauth' ? translate('credential.typeOauth') : translate('credential.typeApiKey')
          const masked = status.activeMaskedSecret === undefined ? '' : ` ${status.activeMaskedSecret}`
          lines.push(`${translate('credential.activeType')}: ${label}${masked}`)
        }
        if (status.username) lines.push(`${translate('status.username')}: ${status.username}`)
        lines.push(`${translate('credential.count')}: ${status.count}`)
        lines.push(translate('apikey.hidden'))
        return lines.join('\n')
      },
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_stats',
      description: 'Show aggregated Agent collaboration battle stats for DSH sessions.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => {
        try {
          /* 任一凭证已激活即可查看战绩(两种凭证同权) */
          if ((await this.options.auth.getActiveSecret()) === null) return translate('status.notConfigured')
        } catch (error) {
          if (error instanceof NotAuthenticatedError) return translate('status.notConfigured')
          throw error
        }
        const view = this.options.resolveStats()
        const stats = { ...view.aggregate, sessionId: '(scope)', lastPromptLength: 0 }
        /* 与 Web 战绩表同名称同口径:时长 hh:MM:ss,平均输出速度为单位 token/s 的整数 */
        return [
          `${translate('stats.title')}:`,
          `${translate('stats.promptChars')}: ${stats.promptChars}`,
          `${translate('stats.promptEstimate')}: ${stats.promptTokens}`,
          `${translate('stats.thinkingMs')}: ${formatThinkingDuration(stats.thinkingMs)}`,
          `${translate('stats.outputTokens')}: ${stats.outputTokens}`,
          `${translate('stats.apiEffectiveTokens')}: ${effectiveTokens(stats)}`,
          `${translate('stats.cacheHitTokens')}: ${stats.cacheReadTokens}`,
          `${translate('stats.avgOutputSpeed')}: ${averageOutputSpeed(stats.outputTokens, stats.thinkingMs)} token/s`,
          `${translate('stats.inputTokens')}: ${stats.inputTokens}`,
          `${translate('stats.scope')}: ${view.scope === 'current' ? translate('stats.scopeCurrent') : translate('stats.scopeAll')}`,
        ].join('\n')
      },
    }))
  }

  /* 配置工具:get 全部配置 / set 单键 / 凭证的列出与增删切换 */
  private async handleConfig(args: Record<string, unknown>): Promise<string> {
    const op = String(args.op ?? '')
    if (op === 'get') return this.describeConfig()
    if (op === 'set') return this.setConfig(args)
    if (op === 'list_credentials') return this.listCredentials()
    if (op === 'set_credential') return this.setCredential(String(args.secret ?? ''))
    if (op === 'switch_credential') return this.switchCredential(String(args.id ?? ''))
    if (op === 'remove_credential') return this.removeCredential(String(args.id ?? ''))
    return `${translate('config.writeError')}: ${translate('config.unknownOp')}`
  }

  /* get:返回全部配置;凭证只报激活类型与打码值,不回显明文 */
  private async describeConfig(): Promise<string> {
    const config = this.options.runtimeConfig.get()
    const status = await this.options.auth.getStatus()
    const active = status.activeType === undefined
      ? '(not configured)'
      : `${status.activeType} ${status.activeMaskedSecret ?? ''}`.trim()
    const lines = [
      `enabled=${config.enabled}`,
      `locale=${config.locale}`,
      `reportInterval=${config.reportInterval}`,
      `reportEnabled=${config.reportEnabled}`,
      `includeTokens=${config.includeTokens}`,
      `includePrompts=${config.includePrompts}`,
      `debug=${config.debug}`,
      `tableBorders=${config.tableBorders}`,
      `statsScope=${config.statsScope}`,
      `digitGrouping=${config.digitGrouping}`,
      `credential=${active}`,
      `credentials=${status.count}`,
    ]
    return lines.join('\n')
  }

  /* set:单键更新(白名单校验 + 类型校验) */
  private async setConfig(args: Record<string, unknown>): Promise<string> {
    const key = String(args.key ?? '')
    const value = args.value
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      return `${translate('config.unknownKey')}: ${key}`
    }
    const type = KEY_TYPES[key as (typeof CONFIG_KEYS)[number]]
    if (typeof value !== type) {
      return `${translate('config.invalidValue')}: ${key} ${translate('config.typeRequired').replace('{type}', type)}`
    }
    const allowed = KEY_VALUES[key as (typeof CONFIG_KEYS)[number]]
    if (allowed !== undefined && !allowed.includes(String(value))) {
      return `${translate('config.invalidValue')}: ${key} (${allowed.join(' | ')})`
    }
    await this.options.runtimeConfig.update({ [key]: value } as never)
    return `${key}=${String(value)}`
  }

  /* list_credentials:列出已保存凭证(打码), 当前激活项标注 */
  private async listCredentials(): Promise<string> {
    const list = await this.options.auth.listCredentials()
    if (list.length === 0) return translate('credential.listEmpty')
    const lines = list.map((item) => {
      const marks = [item.id, credentialTypeLabel(item.type), item.maskedSecret]
      if (item.active) marks.push(translate('credential.current'))
      if (item.username !== undefined) marks.push(item.username)
      return marks.join('  ')
    })
    return [translate('credential.listTitle'), ...lines].join('\n')
  }

  /* set_credential:保存并激活一份凭证(类型自动识别, 仅覆盖不可查看) */
  private async setCredential(secret: string): Promise<string> {
    try {
      const result = await this.options.auth.addCredential(secret)
      const label = credentialTypeLabel(result.summary.type)
      const suffix = result.profile.username === undefined ? '' : `: ${result.profile.username}`
      const prefix = result.existed ? translate('credential.switched') : translate('credential.added')
      return `${prefix} ${label}${suffix}`
    } catch (error) {
      return credentialErrorText(error)
    }
  }

  /* switch_credential:切换激活凭证 */
  private async switchCredential(id: string): Promise<string> {
    try {
      const summary = await this.options.auth.switchCredential(id)
      return `${translate('credential.switched')}: ${credentialTypeLabel(summary.type)} ${summary.maskedSecret}`
    } catch (error) {
      return credentialErrorText(error)
    }
  }

  /* remove_credential:移除一份凭证(当前激活项需先切换) */
  private async removeCredential(id: string): Promise<string> {
    try {
      await this.options.auth.removeCredential(id)
      return translate('credential.removed')
    } catch (error) {
      return credentialErrorText(error)
    }
  }
}

/* 凭证类型 -> 文案 */
function credentialTypeLabel(type: 'api_key' | 'oauth'): string {
  return type === 'oauth' ? translate('credential.typeOauth') : translate('credential.typeApiKey')
}

/* 凭证操作错误 -> 可读文案 */
function credentialErrorText(error: unknown): string {
  if (error instanceof CredentialInputError) {
    switch (error.code) {
      case 'empty': return translate('credential.errEmpty')
      case 'client_secret': return translate('credential.errClientSecret')
      case 'unknown_format': return translate('credential.errUnknownFormat')
      case 'not_found': return translate('credential.errNotFound')
      case 'active': return translate('credential.errActive')
    }
  }
  return translate('credential.errInvalid')
}
