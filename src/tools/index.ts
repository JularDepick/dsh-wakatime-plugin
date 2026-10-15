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
  'includeTokens', 'includePrompts', 'debug', 'tableBorders', 'statsScope',
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
}

/* 枚举型配置键的合法取值 */
const KEY_VALUES: Partial<Record<(typeof CONFIG_KEYS)[number], readonly string[]>> = {
  statsScope: ['all', 'current'],
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
      description: 'Read or update WakaTime plugin configuration. The API key can be overwritten but never read back.',
      parameters: {
        op: {
          type: 'string',
          enum: ['get', 'set', 'set_apikey'],
          description: 'get: read config; set: update one config key; set_apikey: overwrite the API key',
          required: true,
        },
        key: { type: 'string', description: 'Config key for op=set' },
        value: { type: 'json', description: 'Config value for op=set' },
        apiKey: { type: 'string', description: 'New API key for op=set_apikey (overwrite only)' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: (args) => this.handleConfig(args),
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_logout',
      description: 'Clear the locally stored WakaTime API key.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => {
        await this.options.auth.clearApiKey()
        return translate('apikey.cleared')
      },
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_status',
      description: 'Show the current WakaTime API key configuration status.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => {
        const status = await this.options.auth.getStatus()
        if (!status.configured) return translate('status.notConfigured')
        const lines = [`${translate('status.configured')}`]
        if (status.username) lines.push(`${translate('status.username')}: ${status.username}`)
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
          await this.options.auth.getApiKey()
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
          `${translate('stats.avgOutputSpeed')}: ${averageOutputSpeed(stats.outputTokens, stats.thinkingMs)} token/s`,
          `${translate('stats.inputTokens')}: ${stats.inputTokens}`,
          `${translate('stats.scope')}: ${view.scope === 'current' ? translate('stats.scopeCurrent') : translate('stats.scopeAll')}`,
        ].join('\n')
      },
    }))
  }

  /* 配置工具:get 全部配置(set 单键)、set_apikey 覆盖写入 Key */
  private async handleConfig(args: Record<string, unknown>): Promise<string> {
    const op = String(args.op ?? '')
    if (op === 'get') return this.describeConfig()
    if (op === 'set') return this.setConfig(args)
    if (op === 'set_apikey') return this.setApiKey(String(args.apiKey ?? ''))
    return `${translate('config.writeError')}: ${translate('config.unknownOp')}`
  }

  /* get:返回全部配置;apiKey 仅显示是否配置,不回显明文 */
  private async describeConfig(): Promise<string> {
    const config = this.options.runtimeConfig.get()
    const status = await this.options.auth.getStatus()
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
      `apiKey=${status.configured ? '(configured)' : '(not configured)'}`,
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

  /* set_apikey:覆盖写入 API Key(Agent 可代替用户配置,仅覆盖不可查看) */
  private async setApiKey(apiKey: string): Promise<string> {
    if (!apiKey.trim()) return `${translate('config.invalidValue')}: apiKey`
    try {
      const profile = await this.options.auth.setApiKey(apiKey)
      return profile.username
        ? `${translate('apikey.setOk')}: ${profile.username}`
        : translate('apikey.setOk')
    } catch {
      return translate('apikey.invalid')
    }
  }
}
