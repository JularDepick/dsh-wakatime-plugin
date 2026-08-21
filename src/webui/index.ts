/*
 * Web UI 后端路由(小后端)
 * 作者: JularDepick
 *
 * 在 dsh host webserver 服务上注册接口(仅 web profile 提供该服务),
 * 前端只与本后端通信,敏感操作一律由本端代理:
 * - GET  /api/wakatime/status   认证状态(不含 Key 明文)+ 配置 + 全局战绩
 * - POST /api/wakatime/config   写入 Web 可编辑配置项
 * - POST /api/wakatime/apikey   覆盖写入 API Key(验证后存储,不回显)
 * - GET  /api/wakatime/logs     上报记录日志(调试级)
 * 服务缺失(CLI profile)时自动跳过,不阻塞插件;服务出现/销毁经
 * internal/service 事件跟随,注册随插件卸载自动清理。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthManager } from '../auth'
import { WEB_APIKEY_PATH, WEB_CONFIG_PATH, WEB_LOGS_PATH, WEB_STATUS_PATH } from '../constants'
import type { HeartbeatEngine } from '../heartbeat'
import type { RuntimeConfig, WebConfigPatch } from '../runtime-config'
import type { StatsTracker } from '../stats'
import type { WebApiKeyPayload, WebConfigResponse, WebLogEntry, WebStatusResponse } from './types'

export interface WebUiDeps {
  runtimeConfig: RuntimeConfig
  auth: AuthManager
  stats: StatsTracker
  heartbeat: HeartbeatEngine
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
const PATCH_FIELDS: Record<keyof WebConfigPatch, 'boolean' | 'string' | 'number'> = {
  enabled: 'boolean',
  reportInterval: 'number',
  reportEnabled: 'boolean',
  includeTokens: 'boolean',
  includePrompts: 'boolean',
  debug: 'boolean',
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
    },
    stats: {
      aggregate: deps.stats.aggregate(),
    },
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
    writeJson(res, 200, { ok: true, username: profile.username ?? null })
  } catch (error) {
    writeJson(res, 400, { ok: false, error: (error as Error).message })
  }
}

async function handleLogs(req: IncomingMessage, res: ServerResponse, deps: WebUiDeps): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  const body: WebLogEntry[] = [...deps.heartbeat.reportLogs()]
  writeJson(res, 200, body)
}

/* 白名单校验:未知字段忽略,已知字段类型不符整体拒绝 */
function sanitizePatch(value: unknown): WebConfigPatch | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const patch: WebConfigPatch = {}
  for (const [key, type] of Object.entries(PATCH_FIELDS) as [keyof WebConfigPatch, 'boolean' | 'string' | 'number'][]) {
    const raw = (value as Record<string, unknown>)[key]
    if (raw === undefined) continue
    if (type === 'boolean' && typeof raw !== 'boolean') return undefined
    if (type === 'string' && typeof raw !== 'string') return undefined
    if (type === 'number' && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)) return undefined
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
