/*
 * Web UI 后端路由(小后端)
 * 作者: JularDepick
 *
 * 在 dsh host webserver 服务上注册接口(仅 web profile 提供该服务),
 * 前端只与本后端通信,敏感操作一律由本端代理:
 * - GET  /api/wakatime/status   认证状态(不含 Key 明文)+ 配置 + 按策略解析的战绩视图
 * - POST /api/wakatime/config   写入 Web 可编辑配置项
 * - POST /api/wakatime/apikey   覆盖写入 API Key(验证后存储,不回显)
 * - GET  /api/wakatime/logs     上报记录(失败任务附可重试标识)
 * - POST /api/wakatime/retry    手动重试一条失败推送任务
 * - GET  /api/wakatime/buckets  API Key 缓存清单(模糊 Key + 各 Key 自己的战绩视图)
 * - POST /api/wakatime/bucket/remove 移除一个长期未登录的 Key 缓存(需满足静默期)
 * - GET  /api/wakatime/sync     云端 AI 聚合(写入当前 Key 的数据桶,带缓存,?force=1 强制刷新)
 * - POST /api/wakatime/apikey/clear 清除本地 API Key(回退未登录)
 * 战绩合并(桶内与云端取最大、跨桶按显示策略求和)统一在本端完成,
 * 前端只渲染结果,不再自行合并。
 * 密钥安全边界: 明文 API Key 只在本端内部使用,任何响应都不回显;
 * 唯一例外是缓存清单接口按用户要求下发展示用模糊 Key(保留首尾各 8 字符,其余以 * 代替).
 * 服务缺失(CLI profile)时自动跳过,不阻塞插件;服务出现/销毁经
 * internal/service 事件跟随,注册随插件卸载自动清理。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthManager } from '../auth'
import type { BucketStore } from '../bucket-store'
import { resolveStatsView, UNASSIGNED_BUCKET } from '../bucket-store'
import type { StatsView } from '../bucket-store/resolve'
import { WEB_APIKEY_CLEAR_PATH, WEB_APIKEY_PATH, WEB_BUCKET_REMOVE_PATH, WEB_BUCKETS_PATH, WEB_CONFIG_PATH, WEB_LOGS_PATH, WEB_RETRY_PATH, WEB_STATUS_PATH, WEB_SYNC_PATH } from '../constants'
import type { HeartbeatEngine } from '../heartbeat'
import type { RuntimeConfig, WebConfigPatch } from '../runtime-config'
import type { CloudSync } from '../sync'
import type { WebApiKeyPayload, WebBucketEntry, WebBucketRemovePayload, WebBucketRemoveResponse, WebBucketsResponse, WebConfigResponse, WebLogEntry, WebRetryPayload, WebRetryResponse, WebStatusResponse, WebSyncResponse } from './types'

export interface WebUiDeps {
  runtimeConfig: RuntimeConfig
  auth: AuthManager
  heartbeat: HeartbeatEngine
  sync: CloudSync
  store: BucketStore
  /* 当前数据桶标识(未配置 Key 时为未指派桶) */
  currentBucket: () => string
  /* 数据桶与当前 Key 对齐(Key 变更后调用) */
  syncBucket: () => Promise<void>
}

/* webserver 服务最小面(避免引入 host 包类型依赖) */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/* 请求体读取上限(64 KiB,防滥用) */
const BODY_LIMIT = 64 * 1024

/* Web 可编辑字段白名单与类型约束(不含凭证;语言跟随 dsh web,不提供配置项) */
const PATCH_FIELDS: Record<keyof WebConfigPatch, { type: 'boolean' | 'string' | 'number', values?: readonly string[] }> = {
  enabled: { type: 'boolean' },
  reportInterval: { type: 'number' },
  reportEnabled: { type: 'boolean' },
  includeTokens: { type: 'boolean' },
  includePrompts: { type: 'boolean' },
  debug: { type: 'boolean' },
  tableBorders: { type: 'boolean' },
  statsScope: { type: 'string', values: ['all', 'current'] },
}

/* 挂载 Web UI 路由;返回的清理函数随插件卸载调用 */
export function attachWebUi(ctx: Context, deps: WebUiDeps): void {
  let disposeRoutes: (() => void) | undefined

  const registerRoutes = (): void => {
    const webServer = ctx.get('webServer', false) as WebServerLike | undefined
    if (!webServer) return
    const disposers = [
      webServer.register({ kind: 'exact', path: WEB_STATUS_PATH, handler: (req, res) => void handleStatus(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_CONFIG_PATH, handler: (req, res) => void handleConfig(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_APIKEY_PATH, handler: (req, res) => void handleApiKey(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_LOGS_PATH, handler: (req, res) => void handleLogs(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_RETRY_PATH, handler: (req, res) => void handleRetry(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_BUCKETS_PATH, handler: (req, res) => void handleBuckets(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_BUCKET_REMOVE_PATH, handler: (req, res) => void handleBucketRemove(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_SYNC_PATH, handler: (req, res) => void handleSync(req, res, deps) }),
      webServer.register({ kind: 'exact', path: WEB_APIKEY_CLEAR_PATH, handler: (req, res) => void handleApiKeyClear(req, res, deps) }),
    ]
    disposeRoutes = () => { for (const dispose of disposers) dispose() }
  }

  registerRoutes()
  /* 服务晚于插件出现时补挂;销毁时先摘除,避免注册陈旧处理器 */
  ctx.on('internal/service', (name) => {
    if (name !== 'webServer') return
    disposeRoutes?.()
    disposeRoutes = undefined
    registerRoutes()
  })
  ctx.effect(() => () => { disposeRoutes?.() })
}

async function handleStatus(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  await deps.syncBucket()
  const status = await deps.auth.getStatus()
  const config = deps.runtimeConfig.get()
  const body: WebStatusResponse = {
    configured: status.configured,
    ...(status.configured && status.username !== undefined ? { username: status.username } : {}),
    config: {
      enabled: config.enabled,
      reportInterval: config.reportInterval,
      reportEnabled: config.reportEnabled,
      includeTokens: config.includeTokens,
      includePrompts: config.includePrompts,
      debug: config.debug,
      tableBorders: config.tableBorders,
      statsScope: config.statsScope,
    },
    stats: resolveView(deps),
  }
  writeJson(res, 200, body)
}

async function handleConfig(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let payload: unknown
  try {
    payload = JSON.parse(await readBody(req))
  } catch {
    res.writeHead(400)
    res.end('invalid json body')
    return
  }
  const patch = sanitizePatch(payload)
  if (!patch) {
    res.writeHead(400)
    res.end('invalid config patch')
    return
  }
  await deps.runtimeConfig.update(patch)
  const body: WebConfigResponse = { ok: true }
  writeJson(res, 200, body)
}

/* API Key 覆盖写入:验证有效后存储,任何响应不回显 Key 明文 */
async function handleApiKey(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let payload: WebApiKeyPayload
  try {
    payload = JSON.parse(await readBody(req)) as WebApiKeyPayload
  } catch {
    res.writeHead(400)
    res.end('invalid json body')
    return
  }
  if (typeof payload.apiKey !== 'string' || payload.apiKey.trim() === '') {
    res.writeHead(400)
    res.end('apiKey is required')
    return
  }
  /* 小后端先验证 API Key 有效性:失败不保存并回报结果(不携带 Key) */
  try {
    const profile = await deps.auth.setApiKey(payload.apiKey)
    await deps.syncBucket()
    writeJson(res, 200, { ok: true, username: profile.username ?? null })
  } catch (error) {
    writeJson(res, 400, { ok: false, error: (error as Error).message })
  }
}

/* 上报记录:失败任务附带心跳对象与尝试次数,供前端渲染重试入口 */
async function handleLogs(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  const failed = new Map(deps.heartbeat.pendingState().failed.map((task) => [task.id, task]))
  const body: WebLogEntry[] = deps.heartbeat.reportLog().map((entry) => {
    const task = entry.taskId !== undefined ? failed.get(entry.taskId) : undefined
    return {
      id: entry.id,
      time: entry.time,
      kind: entry.kind,
      count: entry.count,
      ok: entry.ok,
      ...(entry.state !== undefined ? { state: entry.state } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
      ...(entry.taskId !== undefined ? { taskId: entry.taskId } : {}),
      ...(task !== undefined ? { entity: task.heartbeat.entity, attempts: task.attempts } : {}),
    }
  })
  writeJson(res, 200, body)
}

/* 手动重试一条失败任务:移回推送队列并立即尝试一轮 */
async function handleRetry(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let payload: WebRetryPayload
  try {
    payload = JSON.parse(await readBody(req)) as WebRetryPayload
  } catch {
    res.writeHead(400)
    res.end('invalid json body')
    return
  }
  if (typeof payload.id !== 'string' || payload.id === '') {
    res.writeHead(400)
    res.end('id is required')
    return
  }
  if (!deps.heartbeat.retryFailedTask(payload.id)) {
    const body: WebRetryResponse = { ok: false, error: 'task not found' }
    writeJson(res, 404, body)
    return
  }
  void deps.heartbeat.push()
  const body: WebRetryResponse = { ok: true }
  writeJson(res, 200, body)
}

/* 清除本地 API Key(回退未登录;成功不回显任何密钥信息) */
async function handleApiKeyClear(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  await deps.auth.clearApiKey()
  await deps.syncBucket()
  const body: WebConfigResponse = { ok: true }
  writeJson(res, 200, body)
}

/* 云端同步:拉取 summaries AI 聚合写入当前 Key 的数据桶,返回解析后的战绩视图;
   ?force=1 跳过缓存;未配置 Key 或失败均返回可读原因 */
async function handleSync(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  await deps.syncBucket()
  const force = isForceRequest(req.url)
  const data = await deps.sync.sync({ force })
  if (data !== null) {
    deps.store.setCloud(deps.currentBucket(), data)
    const body: WebSyncResponse = { ok: true, data: resolveView(deps) }
    writeJson(res, 200, body)
    return
  }
  const status = await deps.auth.getStatus()
  writeJson(res, 200, {
    ok: false,
    error: status.configured ? 'sync failed (network or upstream error)' : 'API key not configured',
  } satisfies WebSyncResponse)
}

/* API Key 缓存清单:模糊 Key + 每个 Key 自己的战绩视图;当前密钥排最前,其余按最后更新倒序 */
async function handleBuckets(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  await deps.syncBucket()
  const current = deps.currentBucket()
  const now = Date.now()
  const buckets: WebBucketEntry[] = Object.entries(deps.store.buckets()).map(([key, bucket]) => ({
    key,
    /* 模糊 Key 只在此接口下发;旧版桶没有该字段时回退为摘要标识 */
    maskedKey: bucket.maskedKey ?? `#${key.slice(0, 8)}`,
    updatedAt: bucket.updatedAt,
    current: key === current,
    removable: key !== current && deps.store.isStale(key, now),
    stats: resolveStatsView(deps.store.buckets(), 'current', key),
  }))
  buckets.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1
    return right.updatedAt - left.updatedAt
  })
  const body: WebBucketsResponse = { buckets }
  writeJson(res, 200, body)
}

/* 移除一个长期未登录的 Key 缓存:仅允许非当前 Key 且超过静默期的桶;
   移除后立即落盘,前端据此重新拉取落盘数据 */
async function handleBucketRemove(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let payload: WebBucketRemovePayload
  try {
    payload = JSON.parse(await readBody(req)) as WebBucketRemovePayload
  } catch {
    res.writeHead(400)
    res.end('invalid json body')
    return
  }
  if (typeof payload.key !== 'string' || payload.key === '') {
    res.writeHead(400)
    res.end('key is required')
    return
  }
  await deps.syncBucket()
  const fail = (code: number, error: string): void => {
    writeJson(res, code, { ok: false, error } satisfies WebBucketRemoveResponse)
  }
  const key = payload.key
  if (key === deps.currentBucket() || key === UNASSIGNED_BUCKET) {
    fail(409, 'bucket-in-use')
    return
  }
  if (deps.store.buckets()[key] === undefined) {
    fail(404, 'bucket-not-found')
    return
  }
  if (!deps.store.isStale(key)) {
    fail(409, 'bucket-not-removable')
    return
  }
  deps.store.removeBucket(key)
  /* 立即落盘:避免防抖窗口内前端重新拉取时旧数据仍在 */
  await deps.store.flush()
  writeJson(res, 200, { ok: true } satisfies WebBucketRemoveResponse)
}

/* 按当前显示策略解析战绩视图 */
function resolveView(deps: WebUiDeps): StatsView {
  return resolveStatsView(deps.store.buckets(), deps.runtimeConfig.get().statsScope, deps.currentBucket())
}

/* 手动同步:URL 携带 force=1 时跳过缓存 */
function isForceRequest(url: string | undefined): boolean {
  if (url === undefined) return false
  const query = url.indexOf('?')
  if (query < 0) return false
  return new URLSearchParams(url.slice(query + 1)).get('force') === '1'
}

/* 白名单校验:未知字段忽略,已知字段类型不符(或枚举越界)整体拒绝 */
function sanitizePatch(value: unknown): WebConfigPatch | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const patch: WebConfigPatch = {}
  for (const [key, spec] of Object.entries(PATCH_FIELDS) as [keyof WebConfigPatch, { type: 'boolean' | 'string' | 'number', values?: readonly string[] }][]) {
    const raw = (value as Record<string, unknown>)[key]
    if (raw === undefined) continue
    if (spec.type === 'boolean' && typeof raw !== 'boolean') return undefined
    if (spec.type === 'string' && typeof raw !== 'string') return undefined
    if (spec.type === 'number' && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)) return undefined
    if (spec.values !== undefined && !spec.values.includes(String(raw))) return undefined
    patch[key] = raw as never
  }
  return patch
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
      if (data.length > BODY_LIMIT) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(body))
}
