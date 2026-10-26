/*
 * dsh-wakatime-plugin 插件入口
 * 作者: JularDepick
 *
 * 将 DSH 的 AI 交互量化并上报至 WakaTime: 监听 session/event 采集
 * Token 用量、思考时长、工具调用与提示词字符, 心跳入待发送队列由定时器按批推送;
 * 本地只有一份数据, 与凭证无关(更换凭证不丢本地数据);
 * 凭证为单份 OAuth 访问令牌, 经小后端(config-manager + webui 路由)管理,
 * 只允许覆盖写入, 任何读取面不回显明文; 工具面提供 config/logout/status/stats.
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
import { LocalStore } from './local-store'
import { resolveStatsView } from './local-store/resolve'
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

/* 导出模块类: 便于复用与测试 */
export { AuthManagerImpl, pickUsername } from './auth'
export { LocalStore, emptyStore, normalizeStore } from './local-store'
export type { StoreFile } from './local-store'
export { resolveStatsView } from './local-store/resolve'
export type { StatsView } from './local-store/resolve'
export { SessionEventCollector } from './collector'
export { ConfigManagerImpl } from './config-manager'
export { HeartbeatEngineImpl, normalizePendingState } from './heartbeat'
export { compressPendingQueue, mergeAdjacentEntries } from './heartbeat/compress'
export { FetchHttpClient } from './http'
export { WakaTimeError } from './http'
export { ProjectDetector } from './project'
export { RuntimeConfig } from './runtime-config'
export { StatsTracker, normalizeTotals, emptyTotals } from './stats'
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
  /* 调试开关(配置项或环境变量): info 级插件日志受它控制, warn/error 始终转发, 开关改动即时生效 */
  const isDebug = (): boolean => runtimeConfig.get().debug || process.env[ENV_DEBUG] === '1'
  const pluginLogger = logger === undefined ? undefined : {
    info: (message: string) => { if (isDebug()) logger.info?.(message) },
    warn: (message: string) => { logger.warn?.(message) },
    error: (message: string) => { logger.error?.(message) },
  }
  const auth = new AuthManagerImpl(http, configManager)
  const store = new LocalStore({ logger: pluginLogger })
  const heartbeat = new HeartbeatEngineImpl(http, async () => auth.getAuthHeader(), {
    enabled: config.enabled,
    includeTokens: config.includeTokens,
    includePrompts: config.includePrompts,
    logger: pluginLogger,
    onPendingChange: (state) => { store.setPending(state) },
  })
  const stats = new StatsTracker({ onChange: (totals) => { store.setStats(totals) } })
  const project = new ProjectDetector()
  const collector = new SessionEventCollector({ heartbeat, stats, project })
  const cloudSync = new CloudSync(http, auth)
  const resolveStats = () => resolveStatsView(store.snapshot())
  const tools = new WakatimeTools({
    auth,
    runtimeConfig,
    resolveStats,
    refresh: () => store.reloadIfChanged(),
  })

  /* 启动载入完成信号: 载入完成前不推送, 避免与初始载入互相覆盖丢数 */
  let markStoreReady!: () => void
  const storeReady = new Promise<void>((resolve) => { markStoreReady = resolve })

  /* 凭证变更: 云端快照属于账号, 换凭证后作废并自动重新同步; 本地数据保留 */
  const handleCredentialChange = async (): Promise<void> => {
    await storeReady
    store.setCloud(null)
    const data = await cloudSync.sync({ force: true })
    if (data !== null) {
      store.setCloud(data)
      store.save()
    }
  }

  /* 推送一轮: 定时上报关闭时不自动推送(心跳留在队列, 重新开启后继续) */
  const pushOnce = async (): Promise<void> => {
    await storeReady
    if (!runtimeConfig.get().reportEnabled) return
    await heartbeat.push()
  }

  /* 事件采集: 监听器为效果, 卸载自动移除 */
  collector.attach(ctx)

  /* 工具注册: inject 保证 tools 服务就绪 */
  tools.register(ctx)

  /* 定时推送定时器(启动时一次 + 每 reportInterval 秒); 间隔变化时重建 */
  let reportTimer: ReturnType<typeof setInterval> | undefined
  const scheduleReport = (): void => {
    if (reportTimer !== undefined) clearInterval(reportTimer)
    const intervalMs = Math.max(1, runtimeConfig.get().reportInterval) * 1000
    reportTimer = setInterval(() => { void pushOnce() }, intervalMs)
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

  /* 凭证变更(Web 保存/清除或工具写入)后作废旧账号的云端快照并重新同步 */
  ctx.effect(() => auth.onChange(() => { void handleCredentialChange() }))

  /* 启动时恢复 Web 设置页写入的配置: 与本地数据载入一起完成后再放开首轮推送 */
  const restoreConfig = configManager.load()
    .then((stored) => (stored?.settings ? runtimeConfig.mergeStored(stored.settings) : undefined))
    .catch(() => { /* 恢复失败静默, 保留 cordis 配置 */ })

  /* 启动时读取本地数据: 恢复战绩与待发送状态(合并语义, 启动瞬间已入队的心跳不会被覆盖) */
  const restoreStore = async (): Promise<void> => {
    await store.load()
    stats.seed(store.stats())
    heartbeat.restorePending(store.pending())
    /* 把载入窗口内已经产生的实时数据写回存储, 避免启动竞态造成丢数 */
    store.setStats(stats.totals())
    store.setPending(heartbeat.pendingState())
    store.save()
  }
  /* 载入完成(成功或失败)后才放开推送 */
  void Promise.all([restoreStore().catch(() => { /* 载入失败已在内部静默降级 */ }), restoreConfig])
    .finally(() => { markStoreReady() })

  /* 首轮推送 + 定时推送循环; 待发送队列补推独立定时(留出重试节奏) */
  ctx.effect(() => {
    scheduleReport()
    void pushOnce()
    const offlineTimer = setInterval(() => { void pushOnce() }, OFFLINE_FLUSH_INTERVAL_MS)
    return () => {
      if (reportTimer !== undefined) clearInterval(reportTimer)
      clearInterval(offlineTimer)
    }
  })

  /* 卸载: 先把实时数据与待发送状态写回存储, 再写盘(顺序有依赖, 放在同一个 effect 内) */
  ctx.effect(() => () => {
    store.setStats(stats.drain())
    store.setPending(heartbeat.pendingState())
    void store.flush()
  })

  /* Web UI 路由(小后端; web profile 提供 webserver 服务时挂载) */
  attachWebUi(ctx, { runtimeConfig, auth, heartbeat, sync: cloudSync, store })

  if (isDebug()) {
    logger?.info?.('[wakatime] plugin active')
  }
}
