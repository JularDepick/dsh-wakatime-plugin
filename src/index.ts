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
import { RuntimeConfig } from './runtime-config'
import { StatsTracker } from './stats'
import { WakatimeTools } from './tools'
import { setLanguage } from './translation'
import { attachWebUi } from './webui'

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
export { RuntimeConfig } from './runtime-config'
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
  const runtimeConfig = new RuntimeConfig(config, configManager)
  const auth = new AuthManagerImpl(oauth, http, configManager, runtimeConfig)
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
  const tools = new WakatimeTools({ auth, oauth, stats, runtimeConfig })

  /* 事件采集:监听器为效果,卸载自动移除 */
  collector.attach(ctx)

  /* 工具注册:inject 保证 tools 服务就绪 */
  tools.register(ctx)

  /* Web 配置变更即时生效(心跳选项与界面语言) */
  ctx.effect(() => runtimeConfig.onChange((next) => {
    heartbeat.updateOptions({
      enabled: next.enabled,
      heartbeatInterval: next.heartbeatInterval,
      includeTokens: next.includeTokens,
      includePrompts: next.includePrompts,
    })
    setLanguage(next.locale || DEFAULT_LANGUAGE)
  }))

  /* 启动时异步恢复 Web 设置页写入的配置(失败静默,保留 cordis 配置) */
  void configManager.load().then((stored) => {
    if (stored?.settings) void runtimeConfig.mergeStored(stored.settings)
  })

  /* Web UI 路由(web profile 提供 webserver 服务时挂载) */
  attachWebUi(ctx, { runtimeConfig, auth, stats })

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