/*
 * 配置管理模块实现
 * 作者: JularDepick
 *
 * 凭证与配置以 JSON 持久化于用户目录(默认 ~/.dsh/plugins/wakatime/config.json),
 * 目录与文件权限尽力收紧。读写串行化,避免并发覆盖。
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, ENV_CONFIG_DIR } from '../constants'
import type { ConfigManager, StoredConfig } from './types'

/* 配置目录:环境变量覆盖优先,否则相对用户主目录 */
function configDir(): string {
  return process.env[ENV_CONFIG_DIR] ?? join(homedir(), '.dsh', 'plugins', CONFIG_DIR_NAME)
}

function configPath(): string {
  return join(configDir(), CONFIG_FILE_NAME)
}

export class ConfigManagerImpl implements ConfigManager {
  /* 串行化写操作,避免覆盖竞争 */
  private writeQueue: Promise<unknown> = Promise.resolve()

  async load(): Promise<StoredConfig | null> {
    try {
      const text = await readFile(configPath(), 'utf-8')
      const parsed = JSON.parse(text) as StoredConfig
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  save(config: StoredConfig): Promise<void> {
    const task = this.writeQueue.then(async () => {
      await mkdir(configDir(), { recursive: true, mode: 0o700 })
      await writeFile(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 })
    })
    /* 失败不阻塞后续写入 */
    this.writeQueue = task.catch(() => {})
    return task
  }

  clear(): Promise<void> {
    const task = this.writeQueue.then(async () => {
      await unlink(configPath())
    })
    this.writeQueue = task.catch(() => {})
    return task
  }
}

export type { ConfigManager, StoredConfig } from './types'