/*
 * Web UI 后端路由(小后端)
 * 作者: JularDepick
 *
 * 在 dsh host webserver 服务上注册接口(仅 web profile 提供该服务),
 * 前端只与本后端通信,敏感操作一律由本端代理:
 * - GET  /api/wakatime/status   认证状态(不含 Key 明文)+ 配置 + 按策略解析的战绩视图
 * - POST /api/wakatime/config   写入 Web 可编辑配置项
 * - POST /api/wakatime/credential          添加一份凭证(类型按前缀识别,验证后存储,不回显)
 * - POST /api/wakatime/credential/switch   切换激活凭证(每份凭证一个数据桶)
 * - POST /api/wakatime/credential/remove   移除一份凭证并连带删除其数据桶(使用中的不可移除)
 * - POST /api/wakatime/credential/clear    清除本地全部凭证(回退未登录)
 * - GET  /api/wakatime/logs     上报记录(失败任务附可重试标识;含其它进程写入的记录)
 * - POST /api/wakatime/retry    手动重试一条失败推送任务
 * - GET  /api/wakatime/buckets  凭证缓存清单(模糊凭证 + 各凭证自己的战绩视图)
 * - POST /api/wakatime/bucket/remove 移除一份无凭证归属的历史缓存(需超过静默期)
 * - GET  /api/wakatime/sync     云端 AI 聚合(写入当前凭证的数据桶,带缓存,?force=1 强制刷新)
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
import { REPORT_LOG_LIMIT, WEB_BUCKET_REMOVE_PATH, WEB_BUCKETS_PATH, WEB_CONFIG_PATH, WEB_CREDENTIAL_CLEAR_PATH, WEB_CREDENTIAL_PATH, WEB_CREDENTIAL_REMOVE_PATH, WEB_CREDENTIAL_SWITCH_PATH, WEB_LOGS_PATH, WEB_RETRY_PATH, WEB_STATUS_PATH, WEB_SYNC_PATH } from '../constants'
import { CredentialInputError } from '../errors'
import type { HeartbeatEngine, ReportEntry } from '../heartbeat'
import type { RuntimeConfig, WebConfigPatch } from '../runtime-config'
import { validateConfigPatch } from '../runtime-config'
import type { CloudSync } from '../sync'
import type { WebBucketEntry, WebBucketRemovePayload, WebBucketRemoveResponse, WebBucketsResponse, WebConfigResponse, WebCredentialActionResponse, WebCredentialPayload, WebCredentialResponse, WebLogEntry, WebRetryPayload, WebRetryResponse, WebStatusResponse, WebSwitchPayload, WebSyncResponse } from './types'

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
  digitGrouping: { type: 'string', values: ['thousand', 'myriad'] },
}

/* 挂载 Web UI 路由;返回的清理函数随插件卸载调用 */
export function attachWebUi(ctx: Context, deps: WebUiDeps): void {
  let disposeRoutes: (() => void) | undefined

  const registerRoutes = (): void => {
    const webServer = ctx.get('webServer', false) as WebServerLike | undefined
    if (!webServer) return
    /* 统一兜底:处理器异常(如落盘失败)时回 500,避免请求悬挂与未处理的 Promise 拒绝 */
    const safe = (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
      (req: IncomingMessage, res: ServerResponse): void => {
        void handler(req, res).catch(() => {
          if (res.headersSent) {
            if (!res.writableEnded) res.end()
            return
          }
          writeJson(res, 500, { ok: false, error: 'internal error' })
        })
      }
    const disposers = [
      webServer.register({ kind: 'exact', path: WEB_STATUS_PATH, handler: safe((req, res) => handleStatus(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_CONFIG_PATH, handler: safe((req, res) => handleConfig(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_CREDENTIAL_PATH, handler: safe((req, res) => handleCredential(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_CREDENTIAL_SWITCH_PATH, handler: safe((req, res) => handleCredentialSwitch(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_CREDENTIAL_REMOVE_PATH, handler: safe((req, res) => handleCredentialRemove(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_LOGS_PATH, handler: safe((req, res) => handleLogs(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_RETRY_PATH, handler: safe((req, res) => handleRetry(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_BUCKETS_PATH, handler: safe((req, res) => handleBuckets(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_BUCKET_REMOVE_PATH, handler: safe((req, res) => handleBucketRemove(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_SYNC_PATH, handler: safe((req, res) => handleSync(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_CREDENTIAL_CLEAR_PATH, handler: safe((req, res) => handleCredentialClear(req, res, deps)) }),
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
  /* 其它 profile 进程可能刚写过数据:先按 mtime 并入, 界面立即看到对方增量 */
  await deps.store.reloadIfChanged()
  await deps.syncBucket()
  const status = await deps.auth.getStatus()
  const config = deps.runtimeConfig.get()
  const body: WebStatusResponse = {
    configured: status.configured,
    count: status.count,
    ...(status.activeType === undefined ? {} : { activeType: status.activeType }),
    ...(status.activeMaskedSecret === undefined ? {} : { activeMaskedSecret: status.activeMaskedSecret }),
    ...(status.username === undefined ? {} : { username: status.username }),
    fromEnv: status.fromEnv,
    config: {
      enabled: config.enabled,
      reportInterval: config.reportInterval,
      reportEnabled: config.reportEnabled,
      includeTokens: config.includeTokens,
      includePrompts: config.includePrompts,
      debug: config.debug,
      tableBorders: config.tableBorders,
      statsScope: config.statsScope,
      digitGrouping: config.digitGrouping,
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
  const invalid = validateConfigPatch(patch)
  if (invalid !== null) {
    writeJson(res, 400, { ok: false, error: 'invalid-value', field: invalid })
    return
  }
  await deps.runtimeConfig.update(patch)
  const body: WebConfigResponse = { ok: true }
  writeJson(res, 200, body)
}

/* 凭证添加:类型由前缀自动识别(前端不再让用户选择),服务端验证通过后保存并设为激活 */
async function handleCredential(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let payload: WebCredentialPayload
  try {
    payload = JSON.parse(await readBody(req)) as WebCredentialPayload
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid json body' })
    return
  }
  try {
    const secret = typeof payload.secret === 'string' ? payload.secret : ''
    const result = await deps.auth.addCredential(secret)
    await deps.syncBucket()
    const body: WebCredentialResponse = {
      ok: true,
      credential: result.summary,
      username: result.profile.username ?? null,
      existed: result.existed,
    }
    writeJson(res, 200, body)
  } catch (error) {
    /* 格式不合法给稳定错误码(前端按码翻译),其余为验证失败原因 */
    const reason = error instanceof CredentialInputError ? error.code : (error as Error).message
    writeJson(res, 400, { ok: false, error: reason })
  }
}

/* 切换激活凭证:切换后重新对齐数据桶(每份凭证一个桶,互不混算) */
async function handleCredentialSwitch(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let payload: WebSwitchPayload
  try {
    payload = JSON.parse(await readBody(req)) as WebSwitchPayload
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid json body' })
    return
  }
  try {
    await deps.auth.switchCredential(String(payload.id ?? ''))
    await deps.syncBucket()
    const body: WebCredentialActionResponse = { ok: true }
    writeJson(res, 200, body)
  } catch (error) {
    const reason = error instanceof CredentialInputError ? error.code : 'not_found'
    writeJson(res, 400, { ok: false, error: reason })
  }
}

/* 移除凭证:当前激活项需先切换(返回 active);移除后其本地缓存仍留在缓存清单里 */
async function handleCredentialRemove(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  let payload: WebSwitchPayload
  try {
    payload = JSON.parse(await readBody(req)) as WebSwitchPayload
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid json body' })
    return
  }
  try {
    const id = String(payload.id ?? '')
    /* 正在使用的凭证不可移除:其数据桶就是当前桶, 删掉后写入会以空桶复活并丢失累计战绩 */
    if (id === deps.currentBucket()) {
      writeJson(res, 409, { ok: false, error: 'bucket-in-use' })
      return
    }
    await deps.auth.removeCredential(id)
    /* 连同该凭证的本地缓存一起移除, 避免留下无法再使用的孤儿桶 */
    if (deps.store.removeBucket(id)) deps.store.save()
    await deps.syncBucket()
    const body: WebCredentialActionResponse = { ok: true }
    writeJson(res, 200, body)
  } catch (error) {
    const reason = error instanceof CredentialInputError ? error.code : 'not_found'
    writeJson(res, 400, { ok: false, error: reason })
  }
}

/* 清除全部已存凭证(本地缓存保留, 由用户在缓存清单里逐个移除) */
async function handleCredentialClear(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  await deps.auth.clearCredentials()
  await deps.syncBucket()
  const body: WebCredentialActionResponse = { ok: true }
  writeJson(res, 200, body)
}

/* 上报记录:失败任务附带心跳对象与尝试次数,供前端渲染重试入口 */
async function handleLogs(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  /* 其它 profile 进程的上报记录也并进来:先按 mtime 同步磁盘, 再与进程内记录按 id 合并 */
  await deps.store.reloadIfChanged()
  const bucket = deps.store.buckets()[deps.currentBucket()]
  const local = deps.heartbeat.pendingState()
  const disk = bucket?.pending
  const localFailedIds = new Set(local.failed.map((task) => task.id))
  const failed = new Map([...local.failed, ...(disk?.failed ?? [])].map((task) => [task.id, task]))
  const merged = new Map<string, ReportEntry>()
  for (const entry of [...(disk?.report ?? []), ...deps.heartbeat.reportLog()]) merged.set(entry.id, entry)
  const entries = [...merged.values()].sort((a, b) => b.time - a.time).slice(0, REPORT_LOG_LIMIT)
  const body: WebLogEntry[] = entries.map((entry) => {
    const task = entry.taskId !== undefined ? failed.get(entry.taskId) : undefined
    /* 只有本进程持有的失败任务才可重试, 其它进程的只读展示 */
    const localTask = entry.taskId !== undefined && localFailedIds.has(entry.taskId)
    return {
      id: entry.id,
      time: entry.time,
      kind: entry.kind,
      count: entry.count,
      ok: entry.ok,
      ...(entry.state !== undefined ? { state: entry.state } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      ...(entry.taskId !== undefined ? { taskId: entry.taskId } : {}),
      ...(task !== undefined ? { entity: task.heartbeat.entity, attempts: task.attempts } : {}),
      ...(entry.taskId === undefined ? {} : { retryable: localTask }),
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
  /* 等待本轮推送结算后再响应:前端刷新上报记录即可看到重试结果 */
  await deps.heartbeat.push()
  const body: WebRetryResponse = { ok: true }
  writeJson(res, 200, body)
}

/* 清除本地 API Key(回退未登录;成功不回显任何密钥信息) */
/* 云端同步:拉取 summaries AI 聚合写入当前 Key 的数据桶,返回解析后的战绩视图;
   ?force=1 跳过缓存;未配置 Key 或失败均返回可读原因 */
async function handleSync(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  await deps.store.reloadIfChanged()
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
  await deps.store.reloadIfChanged()
  await deps.syncBucket()
  const current = deps.currentBucket()
  const now = Date.now()
  /* 每份凭证一个桶: 清单按凭证列表补充类型与账号, 无凭证归属的历史桶照样列出 */
  const credentials = await deps.auth.listCredentials()
  const byId = new Map(credentials.map((item) => [item.id, item]))
  const buckets: WebBucketEntry[] = Object.entries(deps.store.buckets())
    /* 未指派桶不是真实凭证: 既不在缓存清单展示, 也不可移除 */
    .filter(([key]) => key !== UNASSIGNED_BUCKET)
    .map(([key, bucket]) => {
      const credential = byId.get(key)
      return {
        key,
        /* 模糊凭证由凭证列表统一下发;旧版桶仍存有历史打码值, 用作孤儿桶的回退显示 */
        maskedKey: credential?.maskedSecret ?? bucket.maskedKey ?? '#' + key.slice(0, 8),
        ...(credential === undefined ? {} : { credentialType: credential.type }),
        ...(credential?.username === undefined ? {} : { username: credential.username }),
        active: key === current,
        updatedAt: bucket.updatedAt,
        removable: key !== current && deps.store.isStale(key, now),
        stats: resolveStatsView(deps.store.buckets(), 'current', key),
      }
    })
  buckets.sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1
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
