/*
 * 配置管理模块(占位)
 * 作者: JularDepick
 *
 * 初始化阶段仅声明结构与能力边界,功能实现留待后续会话按 AGENTS.md 指示进行。
 */

import { NotImplementedError } from '../errors'
import type { ConfigManager, StoredConfig } from './types'

export class ConfigManagerImpl implements ConfigManager {
  async load(): Promise<StoredConfig | null> {
    throw new NotImplementedError('配置读取')
  }

  async save(_config: StoredConfig): Promise<void> {
    throw new NotImplementedError('配置写入')
  }

  async clear(): Promise<void> {
    throw new NotImplementedError('配置清除')
  }
}

export type { ConfigManager, StoredConfig } from './types'