/*
 * 插件工具注册
 * 作者: JularDepick
 *
 * 以 dsh 工具形式暴露 WakaTime 命令面:
 * - wakatime_config: 查看/修改插件配置, 并可保存或更换 OAuth 凭证
 * - wakatime_logout: 清除本地凭证(本地数据保留)
 * - wakatime_status: 查看认证状态(不回显明文)
 * - wakatime_stats: 查看 Agent 协作战绩
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AuthManager } from '../auth'
import type { StatsView } from '../local-store/resolve'
import { CredentialInputError, NotAuthenticatedError } from '../errors'
import { averageOutputSpeed, effectiveTokens, formatThinkingDuration } from '../metrics'
import type { RuntimeConfig } from '../runtime-config'
import { validateConfigPatch } from '../runtime-config'
import { translate } from '../translation'

export interface WakatimeToolsOptions {
  auth: AuthManager
  /* 运行时配置:读取/修改全部配置项 */
  runtimeConfig: RuntimeConfig
  /* 战绩视图(与 Web 战绩表同源) */
  resolveStats: () => StatsView
  /* 读取前同步其它 profile 进程写入的数据(按文件 mtime 检测), 缺省时跳过 */
  refresh?: () => Promise<boolean>
}

/* 配置工具可写的键(白名单, 与 WebConfigPatch 对齐, 不含凭证) */
const CONFIG_KEYS = [
  'enabled', 'locale', 'reportInterval', 'reportEnabled',
  'includeTokens', 'includePrompts', 'debug', 'tableBorders', 'digitGrouping',
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
  digitGrouping: 'string',
}

/* 枚举型配置键的合法取值 */
const KEY_VALUES: Partial<Record<(typeof CONFIG_KEYS)[number], readonly string[]>> = {
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
      description: 'Read or update WakaTime plugin configuration and the saved OAuth credential. Plaintext is never read back.',
      parameters: {
        op: {
          type: 'string',
          enum: ['get', 'set', 'set_credential'],
          description: 'get: read config; set: update one config key; set_credential: save or replace the OAuth access token (overwrite only, never read back)',
          required: true,
        },
        key: { type: 'string', description: 'Config key for op=set' },
        value: { type: 'json', description: 'Config value for op=set' },
        secret: { type: 'string', description: 'OAuth access token for op=set_credential (overwrite only, never read back)' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: (args) => this.handleConfig(args),
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_logout',
      description: 'Clear the locally stored WakaTime credential. Local stats are kept.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => {
        try {
          await this.options.auth.clearCredential()
        } catch (error) {
          if (error instanceof CredentialInputError && error.code === 'env_locked') {
            return translate('credential.errEnvLocked')
          }
          throw error
        }
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
        await this.options.refresh?.()
        const status = await this.options.auth.getStatus()
        if (!status.configured) return translate('status.notConfigured')
        const masked = status.maskedSecret === undefined ? '' : ' ' + status.maskedSecret
        const lines = [translate('status.configured')]
        lines.push(translate('credential.activeType') + ': ' + translate('credential.typeOauth') + masked)
        if (status.username) lines.push(translate('status.username') + ': ' + status.username)
        lines.push(translate('credential.hidden'))
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
        await this.options.refresh?.()
        try {
          if ((await this.options.auth.getSecret()) === null) return translate('status.notConfigured')
        } catch (error) {
          if (error instanceof NotAuthenticatedError) return translate('status.notConfigured')
          throw error
        }
        const view = this.options.resolveStats()
        const stats = { ...view.aggregate, sessionId: '(local)', lastPromptLength: 0 }
        /* 与 Web 战绩表同名称同口径: 时长 hh:MM:ss, 平均输出速度为单位 token/s 的整数 */
        const speed = averageOutputSpeed(stats.outputTokens, stats.thinkingMs)
        const lines = [
          translate('stats.title') + ':',
          translate('stats.promptChars') + ': ' + stats.promptChars,
          translate('stats.promptEstimate') + ': ' + stats.promptTokens,
          translate('stats.thinkingMs') + ': ' + formatThinkingDuration(stats.thinkingMs),
          translate('stats.outputTokens') + ': ' + stats.outputTokens,
          translate('stats.apiEffectiveTokens') + ': ' + effectiveTokens(stats),
          translate('stats.cacheHitTokens') + ': ' + stats.cacheReadTokens,
          translate('stats.avgOutputSpeed') + ': ' + translate('stats.tokenPerSecond').replace('{n}', String(speed)),
          translate('stats.inputTokens') + ': ' + stats.inputTokens,
        ]
        return lines.join('\n')
      },
    }))
  }

  /* 配置工具: get 全部配置 / set 单键 / set_credential 保存或更换凭证 */
  private async handleConfig(args: Record<string, unknown>): Promise<string> {
    const op = String(args.op ?? '')
    if (op === 'get') return this.describeConfig()
    if (op === 'set') return this.setConfig(args)
    if (op === 'set_credential') return this.setCredential(String(args.secret ?? ''))
    return translate('config.writeError') + ': ' + translate('config.unknownOp')
  }

  /* get: 返回全部配置; 凭证只报打码值, 不回显明文 */
  private async describeConfig(): Promise<string> {
    const config = this.options.runtimeConfig.get()
    const status = await this.options.auth.getStatus()
    const credential = status.configured
      ? ((status.fromEnv ? 'env ' : '') + (status.maskedSecret ?? '')).trim()
      : translate('status.notConfigured')
    const lines = [
      'enabled=' + config.enabled,
      'locale=' + config.locale,
      'reportInterval=' + config.reportInterval,
      'reportEnabled=' + config.reportEnabled,
      'includeTokens=' + config.includeTokens,
      'includePrompts=' + config.includePrompts,
      'debug=' + config.debug,
      'tableBorders=' + config.tableBorders,
      'digitGrouping=' + config.digitGrouping,
      'credential=' + credential,
    ]
    return lines.join('\n')
  }

  /* set: 单键更新(白名单校验 + 类型校验) */
  private async setConfig(args: Record<string, unknown>): Promise<string> {
    const key = String(args.key ?? '')
    const value = args.value
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      return translate('config.unknownKey') + ': ' + key
    }
    const type = KEY_TYPES[key as (typeof CONFIG_KEYS)[number]]
    if (typeof value !== type) {
      return translate('config.invalidValue') + ': ' + key + ' ' + translate('config.typeRequired').replace('{type}', type)
    }
    const allowed = KEY_VALUES[key as (typeof CONFIG_KEYS)[number]]
    if (allowed !== undefined && !allowed.includes(String(value))) {
      return translate('config.invalidValue') + ': ' + key + ' (' + allowed.join(' | ') + ')'
    }
    if (validateConfigPatch({ [key]: value } as never) !== null) {
      return translate('config.invalidValue') + ': ' + key
    }
    await this.options.runtimeConfig.update({ [key]: value } as never)
    return key + '=' + String(value)
  }

  /* set_credential: 保存或更换 OAuth 凭证(仅覆盖不可查看) */
  private async setCredential(secret: string): Promise<string> {
    try {
      const result = await this.options.auth.setCredential(secret)
      const suffix = result.username === undefined ? '' : ': ' + result.username
      /* existed 表示与已保存内容相同(重复保存), replaced 表示换成了另一份凭证 */
      const prefix = result.replaced ? translate('credential.replaced') : translate('credential.added')
      return prefix + ' ' + translate('credential.typeOauth') + suffix
    } catch (error) {
      if (error instanceof CredentialInputError) {
        switch (error.code) {
          case 'empty': return translate('credential.errEmpty')
          case 'client_secret': return translate('credential.errClientSecret')
          case 'api_key': return translate('credential.errApiKey')
          case 'unknown_format': return translate('credential.errUnknownFormat')
          case 'env_locked': return translate('credential.errEnvLocked')
        }
      }
      return translate('credential.errInvalid')
    }
  }
}
