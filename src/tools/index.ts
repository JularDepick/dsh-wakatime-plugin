/*
 * 插件工具注册
 * 作者: JularDepick
 *
 * 以 dsh 工具形式暴露 WakaTime 命令面:
 * - wakatime_login:启动 OAuth 授权流程
 * - wakatime_logout:撤销授权并清除本地凭证
 * - wakatime_status:查看认证状态
 * - wakatime_stats:查看会话战绩
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import type { AuthManager } from '../auth'
import { OAUTH_CALLBACK_PATH } from '../constants'
import { NotAuthenticatedError } from '../errors'
import type { CallbackServerHandle, OAuthCallbackResult, OAuthService } from '../oauth'
import { openBrowser } from '../oauth/browser'
import type { StatsTracker } from '../stats'
import { translate } from '../translation'

export interface WakatimeToolsOptions {
  auth: AuthManager
  oauth: OAuthService
  stats: StatsTracker
  /* OAuth 本地回调端口 */
  callbackPort: number
}

export class WakatimeTools {
  private readonly options: WakatimeToolsOptions
  /* 活动中的回调服务器,插件卸载时强制关闭 */
  private readonly activeHandles = new Set<CallbackServerHandle>()

  constructor(options: WakatimeToolsOptions) {
    this.options = options
  }

  /* 释放全部活动回调服务器(插件卸载时由 ctx.effect 调用) */
  dispose(): void {
    for (const handle of this.activeHandles) handle.close()
    this.activeHandles.clear()
  }

  /* 注册全部工具;卸载时由框架自动清理 */
  register(ctx: Context): void {
    ctx.tools.register(defineTool({
      name: 'wakatime_login',
      description: 'Start the WakaTime OAuth login flow to authorize heartbeat reporting.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => this.login(),
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_logout',
      description: 'Revoke the WakaTime authorization and clear local credentials.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => this.logout(),
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_status',
      description: 'Show the current WakaTime authorization status.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => this.status(),
    }))
    ctx.tools.register(defineTool({
      name: 'wakatime_stats',
      description: 'Show aggregated WakaTime reporting stats for DSH sessions.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => this.stats(),
    }))
  }

  /* OAuth 登录:本地回调服务器 + 浏览器授权 + 换令牌 + 回填用户资料 */
  private async login(): Promise<string> {
    const { auth, oauth, callbackPort } = this.options
    const credentials = auth.getCredentials()
    if (!credentials.clientId) {
      return translate('oauth.noClientId')
    }

    const state = randomUUID()
    const redirectUri = `http://localhost:${callbackPort}${OAUTH_CALLBACK_PATH}`
    const handle = oauth.startCallbackServer(callbackPort)
    this.activeHandles.add(handle)
    try {
      const authorizeUrl = oauth.buildAuthorizeUrl(credentials, redirectUri, state)
      const opened = openBrowser(authorizeUrl)
      if (!opened) {
        return `${translate('oauth.openFailed')} ${authorizeUrl}`
      }

      let result: OAuthCallbackResult
      try {
        result = await handle.codePromise
      } catch (error) {
        return `${translate('oauth.failed')}: ${(error as Error).message}`
      }

      /* CSRF 校验 */
      if (result.state !== state) {
        return translate('oauth.stateMismatch')
      }

      const pair = await oauth.exchangeCode(credentials, redirectUri, result.code)
      const profile = await auth.fetchUserProfile(pair.accessToken)
      await auth.saveToken(pair, profile)
      return profile.username
        ? `${translate('oauth.success')} ${profile.username}`
        : translate('oauth.success')
    } catch (error) {
      return `${translate('oauth.failed')}: ${(error as Error).message}`
    } finally {
      handle.close()
      this.activeHandles.delete(handle)
    }
  }

  private async logout(): Promise<string> {
    await this.options.auth.logout()
    return translate('oauth.loggedOut')
  }

  private async status(): Promise<string> {
    try {
      const status = await this.options.auth.getStatus()
      if (!status.authenticated) return translate('status.notAuthenticated')
      const lines = [`${translate('status.authenticated')}: ${status.username ?? status.userId ?? '-'}`]
      if (status.expiresAt) {
        lines.push(`${translate('status.expiresAt')}: ${new Date(status.expiresAt * 1000).toISOString()}`)
      }
      return lines.join('\n')
    } catch (error) {
      if (error instanceof NotAuthenticatedError) return translate('status.notAuthenticated')
      return `${translate('oauth.failed')}: ${(error as Error).message}`
    }
  }

  private stats(): string {
    const stats = this.options.stats.aggregate()
    return [
      `${translate('stats.title')}:`,
      `${translate('stats.heartbeats')}: ${stats.heartbeats}`,
      `${translate('stats.toolCalls')}: ${stats.toolCalls}`,
      `${translate('stats.inputTokens')}: ${stats.inputTokens}`,
      `${translate('stats.outputTokens')}: ${stats.outputTokens}`,
    ].join('\n')
  }
}