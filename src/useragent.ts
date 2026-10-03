/*
 * 请求标识(User-Agent)
 * 作者: JularDepick
 *
 * WakaTime 的 Heartbeats 接口从 User-Agent 头解析 Editor 与 OS
 * (官方文档原文:Editor and OS are detected from the User-Agent header),
 * 格式对齐官方 User Agents 示例 `wakatime/v1.90.0 (macOS-14.4.1) JetBrains/2024.1`:
 *   <插件名>/<插件版本> (<系统名>-<系统版本>) <编辑器名>/<编辑器版本>
 * 系统名按 WakaTime 报表惯用写法(Windows / macOS / Linux),编辑器取宿主 dsh;
 * 版本号在运行时从包清单读取,不在源码里重复登记版本号。
 */

import { createRequire } from 'node:module'
import { hostname, platform, release } from 'node:os'

/* 插件与宿主标识(User-Agent 中的名字部分) */
const PLUGIN_NAME = 'dsh-wakatime-plugin'
const EDITOR_NAME = 'dsh'

/* 系统名:WakaTime 按此归类 Operating Systems */
function osName(): string {
  const name = platform()
  if (name === 'win32') return 'Windows'
  if (name === 'darwin') return 'macOS'
  if (name === 'linux') return 'Linux'
  return name
}

/* 读取包清单版本:产物同级即包根,失败回退 unknown */
function readVersion(specifier: string): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require(specifier) as { version?: string }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/* 本机机器名:WakaTime 的 Machines 维度(machine_name 字段与 User-Agent 均可能被采用) */
export function machineName(): string {
  try {
    return hostname() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/* 宿主 dsh 版本:优先宿主 CLI 包,其次与宿主版本对齐的 dsh-session 包(本插件 peer 依赖),
   均解析不到时只给编辑器名,避免出现 unknown 版本 */
function editorToken(): string {
  const hostVersion = readVersion('@deepseek-ai/dsh/package.json')
    ?? readVersion('@deepseek-ai/dsh-session/package.json')
  return hostVersion === undefined ? EDITOR_NAME : `${EDITOR_NAME}/${hostVersion}`
}

/* User-Agent:进程内只构造一次 */
let cached: string | undefined

export function userAgent(): string {
  if (cached !== undefined) return cached
  const pluginVersion = readVersion('../package.json') ?? 'unknown'
  cached = `${PLUGIN_NAME}/${pluginVersion} (${osName()}-${release()}) ${editorToken()}`
  return cached
}
