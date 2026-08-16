/*
 * 运行时可变配置
 * 作者: JularDepick
 *
 * Web 设置页经 /api/wakatime/config 写入的配置项以内存为准即时生效,
 * 同时持久化到本地配置文件的 settings 块;插件启动时异步合并恢复,
 * 不阻塞激活。clientSecret 为敏感字段,不经 Web 编辑。
 */

import type { Config } from './config'
import type { ConfigManager, StoredConfig } from './config-manager'

/* Web 可编辑的配置子集(不含 clientSecret) */
export type WebConfigPatch = Partial<Pick<
  Config,
  'enabled' | 'locale' | 'clientId' | 'callbackPort'
  | 'heartbeatInterval' | 'includeTokens' | 'includePrompts' | 'debug'
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
    this.current = { ...this.current, ...patch }
    await this.persist()
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
    if (Object.keys(patch).length === 0) return
    this.current = { ...this.current, ...patch }
    this.notify()
  }

  /* 订阅配置变更;返回取消订阅函数 */
  onChange(listener: (config: Config) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private async persist(): Promise<void> {
    const stored = await this.configManager.load()
    const previous = stored?.settings
    const settings: StoredSettings = {
      enabled: this.current.enabled,
      heartbeatInterval: this.current.heartbeatInterval,
      projectDetection: previous?.projectDetection ?? 'auto',
      includeTokens: this.current.includeTokens,
      includePrompts: this.current.includePrompts,
      debug: this.current.debug,
      locale: this.current.locale,
      clientId: this.current.clientId,
      callbackPort: this.current.callbackPort,
    }
    await this.configManager.save({ ...(stored ?? {}), settings })
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.current)
  }
}
