/*
 * 配置管理模块实现
 * 作者: JularDepick
 *
 * 凭证与配置以 JSON 持久化于用户目录(默认 ~/.dsh/plugins/wakatime/config.json),
 * 目录与文件权限尽力收紧。读写串行化,避免并发覆盖。
 */

import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, ENV_CONFIG_DIR, ENV_DSH_HOME } from '../constants'
import type { ConfigManager, StoredConfig } from './types'

/* dsh home:DSH_HOME 优先,回退用户主目录(主目录不可用时回退进程工作目录) */
function dshHome(): string {
  const fromEnv = process.env[ENV_DSH_HOME]?.trim()
  if (fromEnv) return fromEnv
  return join(homedir() || process.cwd(), '.dsh')
}

/* 配置目录:环境变量覆盖优先(空串视为未设置),否则置于 dsh home 的 plugins 下 */
export function resolveConfigDir(): string {
  const fromEnv = process.env[ENV_CONFIG_DIR]?.trim()
  return fromEnv || join(dshHome(), 'plugins', CONFIG_DIR_NAME)
}

function configPath(): string {
  return join(resolveConfigDir(), CONFIG_FILE_NAME)
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
      const dir = resolveConfigDir()
      const path = configPath()
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 })
      await hardenPathPermissions(dir, path)
    })
    /* 失败不阻塞后续写入 */
    this.writeQueue = task.catch(() => {})
    return task
  }

  clear(): Promise<void> {
    const task = this.writeQueue.then(async () => {
      try {
        await unlink(configPath())
      } catch (error) {
        /* 文件本就不存在时视为清除完成 */
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })
    this.writeQueue = task.catch(() => {})
    return task
  }
}

/* POSIX 下显式收紧目录与文件权限(已存在文件的 mode 不会因写入而改变);
   Windows 无 POSIX mode,权限依赖用户目录 ACL,此处跳过;收紧失败不影响写入结果 */
export async function hardenPathPermissions(dir: string, path: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    await chmod(dir, 0o700)
    await chmod(path, 0o600)
  } catch {
    /* 尽力而为 */
  }
}

export type { ConfigManager, StoredConfig } from './types'