/*
 * dsh-wakatime-plugin 插件入口
 * 作者: JularDepick
 *
 * 将 DSH 的 AI 交互量化并上报至 WakaTime:监听 session/event 采集
 * Token 用量、思考时长、工具调用与提示词长度,心跳入本地缓冲由
 * 定时器批量上报;API Key 经小后端(config-manager + webui 路由)管理,
 * 只允许覆盖写入,任何读取面不回显明文;工具面提供
 * config/logout/status/stats 四个命令,Agent 可代替用户完成配置。
 */

import type { Context } from '@deepseek-ai/cordis'
import { AuthManagerImpl, basicAuthOf } from './auth'
import { SessionEventCollector } from './collector'
import { Config } from './config'
import type { Config as ConfigType } from './config'
import { ConfigManagerImpl } from './config-manager'
import { DEFAULT_LANGUAGE, ENV_DEBUG, OFFLINE_FLUSH_INTERVAL_MS } from './constants'
import { HeartbeatEngineImpl } from './heartbeat'
import { FetchHttpClient } from './http'
import { ProjectDetector } from './project'
import { RuntimeConfig } from './runtime-config'
import { StatsTracker } from './stats'
import { CloudSync } from './sync'
import { WakatimeTools } from './tools'
import { setLanguage } from './translation'
import { attachWebUi } from './webui'

export const name = 'wakatime'

/* 工具注册依赖 tools 服务 */
export const inject = ['tools']

export { Config }

/* 导出模块类:便于复用与测试 */
export { AuthManagerImpl, basicAuthOf } from './auth'
export { SessionEventCollector } from './collector'
export { ConfigManagerImpl } from './config-manager'
export { HeartbeatEngineImpl } from './heartbeat'
export { FetchHttpClient } from './http'
export { WakaTimeError } from './http'
export { ProjectDetector } from './project'
export { RuntimeConfig } from './runtime-config'
export { StatsTracker } from './stats'
export { CloudSync } from './sync'
export { WakatimeTools } from './tools'
export { translate, setLanguage, getLanguage } from './translation'

export function apply(ctx: Context, config: ConfigType) {
  /* 按配置初始化界面语言(回退默认语言) */
  setLanguage(config.locale || DEFAULT_LANGUAGE)

  const logger = ctx.logger as { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void } | undefined

  /* 装配模块 */
  const configManager = new ConfigManagerImpl()
  const http = new FetchHttpClient()
  const runtimeConfig = new RuntimeConfig(config, configManager)
  const auth = new AuthManagerImpl(http, configManager)
  const heartbeat = new HeartbeatEngineImpl(http, async () => basicAuthOf(await auth.getApiKey()), {
    enabled: config.enabled,
    includeTokens: config.includeTokens,
    includePrompts: config.includePrompts,
    logger,
  })
  const stats = new StatsTracker()
  const project = new ProjectDetector()
  const collector = new SessionEventCollector({ heartbeat, stats, project })
  const cloudSync = new CloudSync(http, auth)
  const tools = new WakatimeTools({ auth, stats, runtimeConfig })

  /* 事件采集:监听器为效果,卸载自动移除 */
  collector.attach(ctx)

  /* 工具注册:inject 保证 tools 服务就绪 */
  tools.register(ctx)

  /* 定时批量上报定时器(启动时一次 + 每 reportInterval 秒);间隔变化时重建 */
  let reportTimer: ReturnType<typeof setInterval> | undefined
  const scheduleReport = (): void => {
    if (reportTimer !== undefined) clearInterval(reportTimer)
    const intervalMs = Math.max(1, runtimeConfig.get().reportInterval) * 1000
    reportTimer = setInterval(() => { void heartbeat.flushBuffered() }, intervalMs)
  }

  /* Web 配置变更即时生效(心跳选项/界面语言/上报定时器) */
  ctx.effect(() => runtimeConfig.onChange((next) => {
    heartbeat.updateOptions({
      enabled: next.enabled,
      includeTokens: next.includeTokens,
      includePrompts: next.includePrompts,
    })
    setLanguage(next.locale || DEFAULT_LANGUAGE)
    scheduleReport()
  }))

  /* 启动时异步恢复 Web 设置页写入的配置(失败静默,保留 cordis 配置) */
  void configManager.load().then((stored) => {
    if (stored?.settings) void runtimeConfig.mergeStored(stored.settings)
  })

  /* 定时上报循环:启动时立即上报一次,之后按间隔循环;离线队列补报独立定时 */
  ctx.effect(() => {
    scheduleReport()
    void heartbeat.flushBuffered()
    const offlineTimer = setInterval(() => {
      void heartbeat.flushOfflineQueue()
    }, OFFLINE_FLUSH_INTERVAL_MS)
    return () => {
      if (reportTimer !== undefined) clearInterval(reportTimer)
      clearInterval(offlineTimer)
    }
  })

  /* Web UI 路由(小后端;web profile 提供 webserver 服务时挂载) */
  attachWebUi(ctx, { runtimeConfig, auth, stats, heartbeat, sync: cloudSync })

  const debug = config.debug || process.env[ENV_DEBUG] === '1'
  if (debug) {
    logger?.info?.('[wakatime] plugin active')
  }
}
