/*
 * dsh-wakatime-plugin 插件入口
 * 作者: JularDepick
 *
 * 将 DSH 的 AI 交互量化并上报至 WakaTime:监听 session/event 采集
 * Token 用量、思考时长、工具调用与提示词长度,心跳入待发送队列由
 * 定时器按批推送;数据按 API Key 分桶存储(未登录期间落未指派桶,
 * 由此后首个配置的 Key 认领),战绩展示按「战绩显示策略」跨桶汇总;
 * API Key 经小后端(config-manager + webui 路由)管理,只允许覆盖写入,
 * 任何读取面不回显明文;工具面提供 config/logout/status/stats 四个命令。
 */

import type { Context } from '@deepseek-ai/cordis'
import { AuthManagerImpl, basicAuthOf } from './auth'
import { bucketKeyOf, BucketStore, maskApiKey, UNASSIGNED_BUCKET } from './bucket-store'
import { resolveStatsView } from './bucket-store/resolve'
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
export { AuthManagerImpl, basicAuthOf, pickUsername } from './auth'
export { bucketKeyOf, BucketStore, maskApiKey, UNASSIGNED_BUCKET } from './bucket-store'
export { resolveStatsView } from './bucket-store/resolve'
export type { StatsView } from './bucket-store/resolve'
export { normalizeBucketFile } from './bucket-store'
export type { BucketFile, DataBucket } from './bucket-store'
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
  const auth = new AuthManagerImpl(http, configManager)
  const store = new BucketStore()
  /* 当前数据桶:未配置 API Key 时为未指派桶 */
  let currentBucket: string = UNASSIGNED_BUCKET
  const heartbeat = new HeartbeatEngineImpl(http, async () => basicAuthOf(await auth.getApiKey()), {
    enabled: config.enabled,
    includeTokens: config.includeTokens,
    includePrompts: config.includePrompts,
    logger,
    onPendingChange: (state) => { store.setPending(currentBucket, state) },
  })
  const stats = new StatsTracker({ onChange: (totals) => { store.setStats(currentBucket, totals) } })
  const project = new ProjectDetector()
  const collector = new SessionEventCollector({ heartbeat, stats, project })
  const cloudSync = new CloudSync(http, auth)
  const resolveStats = () => resolveStatsView(store.buckets(), runtimeConfig.get().statsScope, currentBucket)
  const tools = new WakatimeTools({ auth, runtimeConfig, resolveStats })

  /* 切换数据桶:把当前桶的实时累计量与待发送状态落库,再载入目标桶;
     同时刷新展示用模糊 Key(值不同才写,避免无谓的落盘) */
  let switching = false
  const applyBucket = async (next: string, maskedKey?: string): Promise<void> => {
    const refreshMask = (): void => {
      if (maskedKey === undefined) return
      if (store.ensure(next).maskedKey === maskedKey) return
      store.setMaskedKey(next, maskedKey)
    }
    if (next === currentBucket) {
      refreshMask()
      return
    }
    if (switching) return
    switching = true
    try {
      store.setStats(currentBucket, stats.drain())
      store.setPending(currentBucket, heartbeat.pendingState())
      currentBucket = next
      /* 未指派桶的数据由此后首个配置的 Key 认领 */
      if (next !== UNASSIGNED_BUCKET) store.claimUnassigned(next)
      const bucket = store.ensure(next)
      stats.seed(bucket.stats)
      heartbeat.replacePending(bucket.pending)
      refreshMask()
      store.save()
      logger?.info?.(`[wakatime] switched to data bucket ${next === UNASSIGNED_BUCKET ? 'unassigned' : next}`)
    } finally {
      switching = false
    }
  }

  /* 按当前生效的 API Key 对齐数据桶(未配置时切到未指派桶) */
  const syncBucket = async (): Promise<void> => {
    const apiKey = await auth.tryGetApiKey()
    if (apiKey === null) {
      await applyBucket(UNASSIGNED_BUCKET)
      return
    }
    await applyBucket(bucketKeyOf(apiKey), maskApiKey(apiKey))
  }

  /* 推送一轮前先对齐数据桶,避免换了 Key 还往旧桶写 */
  const pushOnce = async (): Promise<void> => {
    await syncBucket()
    await heartbeat.push()
  }

  /* 事件采集:监听器为效果,卸载自动移除 */
  collector.attach(ctx)

  /* 工具注册:inject 保证 tools 服务就绪 */
  tools.register(ctx)

  /* 定时推送定时器(启动时一次 + 每 reportInterval 秒);间隔变化时重建 */
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

  /* API Key 变更(Web 覆盖写入或清除)后重新对齐数据桶 */
  ctx.effect(() => auth.onChange(() => { void syncBucket() }))

  /* 启动时异步恢复 Web 设置页写入的配置(失败静默,保留 cordis 配置) */
  void configManager.load().then((stored) => {
    if (stored?.settings) void runtimeConfig.mergeStored(stored.settings)
  })

  /* 启动时读取数据桶:确定当前桶、认领未指派数据、恢复战绩与待发送状态
     (用合并语义:启动瞬间已入队的心跳不会被覆盖) */
  void (async () => {
    const apiKey = await auth.tryGetApiKey()
    currentBucket = apiKey === null ? UNASSIGNED_BUCKET : bucketKeyOf(apiKey)
    await store.load(currentBucket)
    if (apiKey !== null) store.setMaskedKey(currentBucket, maskApiKey(apiKey))
    if (currentBucket !== UNASSIGNED_BUCKET) store.claimUnassigned(currentBucket)
    const bucket = store.ensure(currentBucket)
    stats.seed(bucket.stats)
    heartbeat.restorePending(bucket.pending)
    /* 把载入窗口内已经产生的实时数据写回桶,避免启动竞态造成丢数 */
    store.setStats(currentBucket, stats.totals())
    store.setPending(currentBucket, heartbeat.pendingState())
    store.save()
  })()

  /* 首轮推送 + 定时推送循环;待发送队列补推独立定时(留出重试节奏) */
  ctx.effect(() => {
    scheduleReport()
    void pushOnce()
    const offlineTimer = setInterval(() => { void pushOnce() }, OFFLINE_FLUSH_INTERVAL_MS)
    return () => {
      if (reportTimer !== undefined) clearInterval(reportTimer)
      clearInterval(offlineTimer)
    }
  })

  /* 卸载:先把当前桶的实时数据与待发送状态落库,再写盘(顺序有依赖,放在同一个 effect 内) */
  ctx.effect(() => () => {
    store.setStats(currentBucket, stats.drain())
    store.setPending(currentBucket, heartbeat.pendingState())
    void store.flush()
  })

  /* Web UI 路由(小后端;web profile 提供 webserver 服务时挂载) */
  attachWebUi(ctx, {
    runtimeConfig,
    auth,
    heartbeat,
    sync: cloudSync,
    store,
    currentBucket: () => currentBucket,
    syncBucket,
  })

  const debug = config.debug || process.env[ENV_DEBUG] === '1'
  if (debug) {
    logger?.info?.('[wakatime] plugin active')
  }
}
