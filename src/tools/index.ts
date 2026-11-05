/*
 * 插件工具注册
 * 作者: JularDepick
 *
 * 以 dsh 工具形式暴露 WakaTime 命令面:
 * - wakatime_config: 查看/修改插件配置, 并可保存或更换任一槽的凭证
 *   (写入槽 API Key / 读取槽 OAuth 令牌)
 * - wakatime_logout: 清除本地两槽凭证(本地数据保留)
 * - wakatime_status: 查看两槽认证状态与同账号结论(不回显明文)
 * - wakatime_stats: 查看 Agent 协作战绩
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AuthManager } from '../auth'
import type { TransmissionStatus } from '../heartbeat'
import type { StatsView } from '../local-store/resolve'
import { CredentialInputError } from '../errors'
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
  /* 上报运行态(积压/最近成功/凭证是否被拒), 缺省时不输出该段 */
  transmission?: () => TransmissionStatus
}

/* 本地时区时间戳: yyyy-MM-dd HH:mm:ss+HH:mm(与界面日期格式一致) */
function formatTimestamp(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absMinutes = Math.abs(offsetMinutes)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(absMinutes / 60))}:${pad(absMinutes % 60)}`
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
  locale: ['zh-CN', 'en-US'],
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
      description: 'Read or update WakaTime plugin configuration and the credential of one slot. Plaintext is never read back.',
      parameters: {
        op: {
          type: 'string',
          enum: ['get', 'set', 'set_credential'],
          description: 'get: read config; set: update one config key; set_credential: save or replace the credential of one slot (overwrite only, never read back)',
          required: true,
        },
        key: { type: 'string', description: 'Config key for op=set' },
        value: { type: 'json', description: 'Config value for op=set' },
        slot: {
          type: 'string',
          enum: ['write', 'read'],
          description: 'Credential slot for op=set_credential: write accepts a WakaTime API key and is used for heartbeats; read accepts a personal OAuth token and is used for stats',
        },
        secret: {
          type: 'string',
          description: 'API key for slot=write, OAuth access token for slot=read (overwrite only, never read back)',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: (args) => this.handleConfig(args),
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_logout',
      description: 'Clear both locally stored WakaTime credential slots. Local stats are kept.',
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
        /* 逐槽一行: 两槽各自可能未配置或来自环境变量, 合成一行会让用户看不出缺哪一槽 */
        const slotLine = (slot: typeof status.write): string => {
          if (!slot.configured) return translate('status.slotMissing')
          const prefix = slot.fromEnv ? translate('credential.fromEnv') + ' ' : ''
          return (prefix + (slot.maskedSecret ?? '')).trim()
        }
        const verdict = status.sameAccount === 'same'
          ? translate('status.sameAccountSame')
          : status.sameAccount === 'different' ? translate('status.sameAccountDifferent') : translate('status.sameAccountUnknown')
        const lines = [status.configured ? translate('status.configured') : translate('status.notConfigured')]
        lines.push(translate('status.slotWrite') + ': ' + slotLine(status.write))
        lines.push(translate('status.slotRead') + ': ' + slotLine(status.read))
        if (status.username) lines.push(translate('status.username') + ': ' + status.username)
        /* 两槽必须同一账号: 未确认时也要显式说明, 否则用户不知道这个前提 */
        lines.push(translate('status.sameAccount') + ': ' + verdict)
        /* 写权限: 写入槽被拒时心跳永远上报不了, 工具面必须显式提示 */
        if (status.write.configured) {
          lines.push(translate('status.writeScope') + ': ' + (
            status.writeScope === 'ok'
              ? translate('status.writeScopeOk')
              : status.writeScope === 'missing' ? translate('status.writeScopeMissing') : translate('status.writeScopeUnknown')
          ))
        }
        lines.push(translate('credential.hidden'))
        /* 上报运行态: 没有这一段的时代价是"凭证被拒时工具面看起来一切正常" */
        const transmission = this.options.transmission?.()
        if (transmission !== undefined) {
          lines.push(translate('status.queued') + ': ' + transmission.queued)
          if (transmission.failed > 0) lines.push(translate('status.failed') + ': ' + transmission.failed)
          lines.push(transmission.lastSuccessAt === null
            ? translate('status.neverSuccess')
            : translate('status.lastSuccess') + ': ' + formatTimestamp(transmission.lastSuccessAt))
          if (transmission.rejected !== null) {
            lines.push(translate('status.rejected') + ': ' + transmission.rejected.message)
          }
        }
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
        /* 战绩是本地累计量, 与凭证无关: 未配置凭证时同样输出九行(与 Web 战绩表一致),
           凭证只影响云端合并与上报, 不影响本地统计的可读性 */
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
    if (op === 'set_credential') {
      const slot = String(args.slot ?? '')
      if (slot !== 'write' && slot !== 'read') {
        return translate('config.invalidValue') + ': slot (' + translate('credential.typeApiKey') + ' / ' + translate('credential.typeOauth') + ')'
      }
      return this.setCredential(slot, String(args.secret ?? ''))
    }
    return translate('config.writeError') + ': ' + translate('config.unknownOp')
  }

  /* get: 返回全部配置; 凭证只报打码值, 不回显明文 */
  private async describeConfig(): Promise<string> {
    const config = this.options.runtimeConfig.get()
    const status = await this.options.auth.getStatus()
    /* 两槽各报打码值: 只看一个 credential 字段无法判断缺的是写入槽还是读取槽 */
    const credential = (slot: typeof status.write): string => (slot.configured
      ? ((slot.fromEnv ? translate('credential.fromEnv') + ' ' : '') + (slot.maskedSecret ?? '')).trim()
      : translate('status.notConfigured'))
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
      'credential.write=' + credential(status.write),
      'credential.read=' + credential(status.read),
      'sameAccount=' + status.sameAccount,
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

  /* set_credential: 保存或更换某一槽的凭证(仅覆盖不可查看) */
  private async setCredential(slot: 'write' | 'read', secret: string): Promise<string> {
    try {
      const result = await this.options.auth.setCredential(slot, secret)
      const typeName = slot === 'write' ? translate('credential.typeApiKey') : translate('credential.typeOauth')
      const slotName = slot === 'write' ? translate('status.slotWrite') : translate('status.slotRead')
      const suffix = result.username === undefined ? '' : ': ' + result.username
      /* existed 表示与已保存内容相同(重复保存), replaced 表示换成了另一份凭证 */
      const prefix = result.replaced ? translate('credential.replaced') : translate('credential.added')
      const head = prefix + ' [' + slotName + '] ' + typeName + suffix
      /* 另一槽还空着时上报仍暂停, 必须说清楚, 否则用户以为已经修好了 */
      return result.paired ? head : head + '\n' + translate('credential.partial')
    } catch (error) {
      if (error instanceof CredentialInputError) {
        switch (error.code) {
          case 'empty': return translate('credential.errEmpty')
          case 'client_secret': return translate('credential.errClientSecret')
          case 'api_key_format': return translate('credential.errApiKeyFormat')
          case 'oauth_format': return translate('credential.errOauthFormat')
          case 'unknown_format': return translate('credential.errUnknownFormat')
          case 'wrong_slot': return translate('credential.errWrongSlot')
          case 'env_locked': return translate('credential.errEnvLocked')
          case 'write_scope': return translate('credential.errWriteScope')
          case 'network': return translate('credential.errNetwork')
          case 'different_account': return translate('credential.errDifferentAccount')
        }
      }
      return translate('credential.errInvalid')
    }
  }
}
