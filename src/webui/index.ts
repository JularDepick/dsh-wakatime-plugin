/*
 * Web UI 后端路由(小后端)
 * 作者: JularDepick
 *
 * 在 dsh host webserver 服务上注册接口(仅 web profile 提供该服务),
 * 前端只与本后端通信,敏感操作一律由本端代理:
 * - GET  /api/wakatime/status   认证状态(不含明文)+ 配置 + 战绩视图
 * - POST /api/wakatime/config   写入 Web 可编辑配置项
 * - POST /api/wakatime/credential        保存或更换凭证(验证后覆盖, 不回显)
 * - POST /api/wakatime/credential/clear  清除已保存凭证(本地数据保留)
 * - GET  /api/wakatime/logs     上报记录(失败任务附可重试标识;含其它进程写入的记录)
 * - POST /api/wakatime/retry    手动重试一条失败推送任务
 * - GET  /api/wakatime/sync     云端 AI 聚合(写入本地数据,带缓存,?force=1 强制刷新)
 * 战绩合并(本地与云端取最大)统一在本端完成, 前端只渲染结果。
 * 密钥安全边界: 明文凭证只在本端内部使用,任何响应都不回显, 只下发打码值。
 * 服务缺失(CLI profile)时自动跳过,不阻塞插件;服务出现/销毁经
 * internal/service 事件跟随,注册随插件卸载自动清理。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthManager } from '../auth'
import { REPORT_LOG_LIMIT, WEB_CONFIG_PATH, WEB_CREDENTIAL_CLEAR_PATH, WEB_CREDENTIAL_PATH, WEB_LOGS_PATH, WEB_RETRY_PATH, WEB_STATUS_PATH, WEB_SYNC_PATH } from '../constants'
import { CredentialInputError } from '../errors'
import type { HeartbeatEngine, ReportEntry } from '../heartbeat'
import type { LocalStore } from '../local-store'
import { resolveStatsView } from '../local-store'
import type { RuntimeConfig, WebConfigPatch } from '../runtime-config'
import { validateConfigPatch } from '../runtime-config'
import type { CloudSync } from '../sync'
import type { WebConfigResponse, WebCredentialClearResponse, WebCredentialPayload, WebCredentialResponse, WebLogEntry, WebRetryPayload, WebRetryResponse, WebStatusResponse, WebSyncResponse } from './types'

export interface WebUiDeps {
  runtimeConfig: RuntimeConfig
  auth: AuthManager
  heartbeat: HeartbeatEngine
  sync: CloudSync
  store: LocalStore
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
      webServer.register({ kind: 'exact', path: WEB_CREDENTIAL_CLEAR_PATH, handler: safe((req, res) => handleCredentialClear(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_LOGS_PATH, handler: safe((req, res) => handleLogs(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_RETRY_PATH, handler: safe((req, res) => handleRetry(req, res, deps)) }),
      webServer.register({ kind: 'exact', path: WEB_SYNC_PATH, handler: safe((req, res) => handleSync(req, res, deps)) }),
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
  const status = await deps.auth.getStatus()
  const config = deps.runtimeConfig.get()
  const body: WebStatusResponse = {
    configured: status.configured,
    fromEnv: status.fromEnv,
    ...(status.maskedSecret === undefined ? {} : { maskedSecret: status.maskedSecret }),
    ...(status.username === undefined ? {} : { username: status.username }),
    ...(status.updatedAt === undefined ? {} : { credentialUpdatedAt: status.updatedAt }),
    config: {
      enabled: config.enabled,
      reportInterval: config.reportInterval,
      reportEnabled: config.reportEnabled,
      includeTokens: config.includeTokens,
      includePrompts: config.includePrompts,
      debug: config.debug,
      tableBorders: config.tableBorders,
      digitGrouping: config.digitGrouping,
    },
    stats: resolveStatsView(deps.store.snapshot()),
  }
  writeJson(res, 200, body)
}

async function handleConfig(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  if (!guardRequest(req, res)) return
  let payload: unknown
  try {
    payload = JSON.parse(await readBody(req))
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid json body' })
    return
  }
  const patch = sanitizePatch(payload)
  if (!patch) {
    writeJson(res, 400, { ok: false, error: 'invalid config patch' })
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

/* 保存或更换凭证:服务端验证通过后覆盖保存;更换后本地数据保留 */
async function handleCredential(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  if (!guardRequest(req, res)) return
  let payload: WebCredentialPayload
  try {
    payload = JSON.parse(await readBody(req)) as WebCredentialPayload
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid json body' })
    return
  }
  try {
    const secret = typeof payload.secret === 'string' ? payload.secret : ''
    const result = await deps.auth.setCredential(secret)
    const body: WebCredentialResponse = {
      ok: true,
      maskedSecret: result.maskedSecret,
      credentialUpdatedAt: result.updatedAt,
      username: result.username ?? null,
      existed: result.existed,
      replaced: result.replaced,
    }
    writeJson(res, 200, body)
  } catch (error) {
    /* 格式不合法给稳定错误码(前端按码翻译),其余为验证失败原因 */
    const reason = error instanceof CredentialInputError ? error.code : (error as Error).message
    writeJson(res, 400, { ok: false, error: reason })
  }
}

/* 清除已保存凭证(本地数据保留) */
async function handleCredentialClear(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  if (!guardRequest(req, res)) return
  try {
    await deps.auth.clearCredential()
  } catch (error) {
    /* 环境变量凭证生效时配置文件里的凭证删了也不起作用, 明确拒绝而不是假装成功 */
    const reason = error instanceof CredentialInputError ? error.code : 'clear failed'
    writeJson(res, 409, { ok: false, error: reason } satisfies WebCredentialClearResponse)
    return
  }
  const body: WebCredentialClearResponse = { ok: true }
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
  const local = deps.heartbeat.pendingState()
  const disk = deps.store.pending()
  const localFailedIds = new Set(local.failed.map((task) => task.id))
  const failed = new Map([...local.failed, ...disk.failed].map((task) => [task.id, task]))
  const merged = new Map<string, ReportEntry>()
  for (const entry of [...disk.report, ...deps.heartbeat.reportLog()]) merged.set(entry.id, entry)
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
  if (!guardRequest(req, res)) return
  let payload: WebRetryPayload
  try {
    payload = JSON.parse(await readBody(req)) as WebRetryPayload
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid json body' })
    return
  }
  if (typeof payload.id !== 'string' || payload.id === '') {
    writeJson(res, 400, { ok: false, error: 'id is required' })
    return
  }
  if (!deps.heartbeat.retryFailedTask(payload.id)) {
    const body: WebRetryResponse = { ok: false, error: 'task not found' }
    writeJson(res, 404, body)
    return
  }
  /* 在途推送先结算, 再发起一轮:避免 push() 因重入保护直接返回造成"假成功" */
  await deps.heartbeat.whenIdle()
  await deps.heartbeat.push()
  const body: WebRetryResponse = { ok: true }
  writeJson(res, 200, body)
}

/* 云端同步:拉取 summaries AI 聚合写入本地数据,返回解析后的战绩视图;
   ?force=1 跳过缓存;未配置凭证或失败均返回可读原因 */
async function handleSync(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  /* 同步会写云端快照, 属有副作用操作: 带 Origin 时要求同源 */
  if (!guardOrigin(req, res)) return
  await deps.store.reloadIfChanged()
  const force = isForceRequest(req.url)
  const data = await deps.sync.sync({ force })
  if (data !== null) {
    deps.store.setCloud(data)
    const body: WebSyncResponse = { ok: true, data: resolveStatsView(deps.store.snapshot()) }
    writeJson(res, 200, body)
    return
  }
  const status = await deps.auth.getStatus()
  writeJson(res, 200, {
    ok: false,
    error: status.configured ? 'sync failed (network or upstream error)' : 'credential not configured',
  } satisfies WebSyncResponse)
}

/* 写操作来源校验: 要求 application/json(浏览器的跨站简单请求带不了该类型),
   并对自带 Origin 的请求校验同源, 防止任意网页清凭证或改开关 */
function guardOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  /* 同源 GET 通常不带 Origin, 带了才校验 */
  if (typeof origin !== 'string' || origin === '' || typeof host !== 'string') return true
  if (isSameOrigin(origin, host)) return true
  writeJson(res, 403, { ok: false, error: 'origin not allowed' })
  return false
}

/* 同源判定: Host 与 Origin 都按小写比较, 且把 localhost / 127.0.0.1 / [::1] 视为同一类本机来源
   (反向代理可能改写 Host, 直连与回环名混用也不应被拒) */
function isSameOrigin(origin: string, host: string): boolean {
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
  try {
    const parsed = new URL(origin)
    const originHost = parsed.host.toLowerCase()
    const requestHost = host.toLowerCase()
    if (originHost === requestHost) return true
    const originName = parsed.hostname.toLowerCase()
    const requestName = requestHost.startsWith('[')
      ? requestHost.slice(0, requestHost.indexOf(']') + 1)
      : requestHost.split(':')[0]
    return loopback.has(originName) && loopback.has(requestName)
  } catch {
    return false
  }
}

function guardRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (!guardOrigin(req, res)) return false
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    writeJson(res, 415, { ok: false, error: 'content-type must be application/json' })
    return false
  }
  return true
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
