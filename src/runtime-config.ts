/*
 * 运行时可变配置
 * 作者: JularDepick
 *
 * Web 设置页经 /api/wakatime/config 写入的配置项以内存为准即时生效,
 * 同时持久化到本地配置文件的 settings 块;插件启动时异步合并恢复,
 * 不阻塞激活。凭证不经此通道(见 auth 模块)。
 */

import type { Config } from './config'
import type { ConfigManager, StoredConfig } from './config-manager'
import { CONFIG_FILE_VERSION, REPORT_INTERVAL_MAX_SECONDS, SUPPORTED_LANGUAGES } from './constants'

/* Web 可编辑的配置子集(不含凭证;语言跟随 dsh web,不提供配置项) */
/* 配置值范围校验:返回不合法的键名, 合法时返回 null(Web 与工具两条写入通道共用) */
export function validateConfigPatch(patch: WebConfigPatch): string | null {
  const interval = patch.reportInterval
  /* 秒级整数, 且不许超过上限: 超过 setInterval 可表示的毫秒上限会被当成 1ms, 退化成每毫秒推一轮 */
  if (interval !== undefined && (!Number.isInteger(interval) || interval < 1 || interval > REPORT_INTERVAL_MAX_SECONDS)) return 'reportInterval'
  return null
}

export type WebConfigPatch = Partial<Pick<
  Config,
  'enabled' | 'reportInterval' | 'reportEnabled'
  | 'includeTokens' | 'includePrompts' | 'debug' | 'tableBorders' | 'digitGrouping'
>>

/* settings 块中与 Config 字段一致的持久化形态(可缺省,缺失表示未覆盖) */
export type StoredSettings = StoredConfig['settings']

export class RuntimeConfig {
  private current: Config
  private readonly listeners = new Set<(config: Config) => void>()

  constructor(initial: Config, private readonly configManager: ConfigManager) {
    this.current = { ...initial }
  }

  /* 当前生效配置(cordis 配置与 Web 覆盖的合并) */
  get(): Config {
    return this.current
  }

  /* 应用 Web 写入:更新内存、持久化 settings 块并通知订阅者 */
  async update(patch: WebConfigPatch): Promise<Config> {
    const next = { ...this.current, ...patch }
    /* 先落盘再改内存: 落盘失败时内存配置与订阅者仍与磁盘一致, 不会出现"界面显示已改、重启回退" */
    await this.persist(patch)
    this.current = next
    this.notify()
    return this.current
  }

  /* 启动时合并持久化的 Web 覆盖(异步调用,失败静默保留 cordis 配置) */
  async mergeStored(settings: StoredSettings | undefined): Promise<void> {
    if (!settings) return
    const patch: WebConfigPatch = {}
    for (const key of Object.keys(settings) as (keyof WebConfigPatch)[]) {
      const value = settings[key]
      if (value !== undefined) patch[key] = value as never
    }
    /* 从磁盘恢复的 settings 也要过一遍范围校验: 手工改文件写进越界值时不能直接生效 */
    const invalid = validateConfigPatch(patch)
    if (invalid !== null) delete patch[invalid as keyof WebConfigPatch]
    /* 语言只接受白名单值: 持久化文件里的非法值不能生效, 否则翻译加载失败并静默回退中文 */
    const stored = patch as { locale?: unknown }
    if (stored.locale !== undefined
      && (typeof stored.locale !== 'string' || !(SUPPORTED_LANGUAGES as readonly string[]).includes(stored.locale))) {
      delete stored.locale
    }
    if (Object.keys(patch).length === 0) return
    this.current = { ...this.current, ...patch }
    this.notify()
  }

  /* 订阅配置变更;返回取消订阅函数 */
  onChange(listener: (config: Config) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private async persist(patch: WebConfigPatch): Promise<void> {
    const stored = await this.configManager.load()
    /* 只落本次显式改动的键: 把全部配置项都写进 settings 会让之后修改 cordis.yml 静默失效 */
    const settings: StoredSettings = { ...(stored?.settings ?? {}) }
    for (const key of Object.keys(patch) as (keyof WebConfigPatch)[]) {
      const value = patch[key]
      if (value !== undefined) (settings as Record<string, unknown>)[key] = value
    }
    await this.configManager.save({
      ...(stored ?? { version: CONFIG_FILE_VERSION, settings }),
      version: CONFIG_FILE_VERSION,
      settings,
      settingsUpdatedAt: Date.now(),
    })
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.current)
  }
}
