/*
 * dsh-wakatime-plugin 插件入口
 * 作者: JularDepick
 *
 * 将 DSH 的 AI 交互量化并上报至 WakaTime:监听 session/event 采集
 * Token 用量、工具调用与提示词长度,以心跳形式上报;OAuth 2.0
 * 本地回调完成授权,令牌临近过期自动刷新;工具面提供
 * login/logout/status/stats 四个命令。
 */

import type { Context } from '@deepseek-ai/cordis'
import { AuthManagerImpl } from './auth'
import { SessionEventCollector } from './collector'
import { Config } from './config'
import type { Config as ConfigType } from './config'
import { ConfigManagerImpl } from './config-manager'
import { DEFAULT_LANGUAGE, ENV_DEBUG, OFFLINE_FLUSH_INTERVAL_MS } from './constants'
import { HeartbeatEngineImpl } from './heartbeat'
import { FetchHttpClient } from './http'
import { OAuthModule } from './oauth'
import { ProjectDetector } from './project'
import { StatsTracker } from './stats'
import { WakatimeTools } from './tools'
import { setLanguage } from './translation'

export const name = 'wakatime'

/* 工具注册依赖 tools 服务 */
export const inject = ['tools']

export { Config }

/* 导出模块类:便于复用与测试 */
export { AuthManagerImpl } from './auth'
export { SessionEventCollector } from './collector'
export { ConfigManagerImpl } from './config-manager'
export { HeartbeatEngineImpl } from './heartbeat'
export { FetchHttpClient } from './http'
export { WakaTimeError } from './http'
export { OAuthModule } from './oauth'
export { ProjectDetector } from './project'
export { StatsTracker } from './stats'
export { WakatimeTools } from './tools'
export { translate, setLanguage, getLanguage } from './translation'

export function apply(ctx: Context, config: ConfigType) {
  /* 按配置初始化界面语言(回退默认语言) */
  setLanguage(config.locale || DEFAULT_LANGUAGE)

  const logger = ctx.logger as { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void } | undefined

  /* 装配模块 */
  const configManager = new ConfigManagerImpl()
  const http = new FetchHttpClient()
  const oauth = new OAuthModule(http)
  const auth = new AuthManagerImpl(oauth, http, configManager, config.clientId, config.clientSecret)
  const heartbeat = new HeartbeatEngineImpl(http, () => auth.ensureValidToken(), {
    enabled: config.enabled,
    heartbeatInterval: config.heartbeatInterval,
    includeTokens: config.includeTokens,
    includePrompts: config.includePrompts,
    logger,
  })
  const stats = new StatsTracker()
  const project = new ProjectDetector()
  const collector = new SessionEventCollector({ heartbeat, stats, project })
  const tools = new WakatimeTools({ auth, oauth, stats, callbackPort: config.callbackPort })

  /* 事件采集:监听器为效果,卸载自动移除 */
  collector.attach(ctx)

  /* 工具注册:inject 保证 tools 服务就绪 */
  tools.register(ctx)

  /* 离线队列定时补报:手动定时器经 effect 管理,卸载自动清理 */
  ctx.effect(() => {
    const timer = setInterval(() => {
      void heartbeat.flushOfflineQueue()
    }, OFFLINE_FLUSH_INTERVAL_MS)
    return () => clearInterval(timer)
  })

  /* 卸载时关闭活动中的 OAuth 回调服务器 */
  ctx.effect(() => () => tools.dispose())

  const debug = config.debug || process.env[ENV_DEBUG] === '1'
  if (debug) {
    logger?.info?.('[wakatime] plugin active')
  }
}