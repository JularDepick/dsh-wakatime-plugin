/*
 * 配置管理模块实现
 * 作者: JularDepick
 *
 * 凭证与配置以 JSON 持久化于用户目录(默认 ~/.dsh/plugins/wakatime/config.json),
 * 目录与文件权限尽力收紧. 本地只保存一份 OAuth 凭证.
 * 同一数据目录可能被多个 dsh profile 进程同时写入, 因此:
 * - 写操作先抢文件锁, 持锁后重读磁盘并与本次写入按变更时刻合并;
 * - 写入走临时文件 + rename 原子替换;
 * - refresh() 按 mtime 检测其它进程的改动, 供读取面按需同步;
 * - 读取时若当前结构归一化失败, 交给 migrate 模块做一次性迁移并立即落盘.
 */

import { chmod, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, CONFIG_LOCK_FILE_NAME, ENV_CONFIG_DIR, ENV_DSH_HOME, STORAGE_LOCK_BACKOFF_MS, STORAGE_LOCK_RETRIES, STORAGE_LOCK_TTL_MS } from '../constants'
import { migrateStoredConfig } from '../migrate'
import { archiveFile, fileMtime, readJsonFileState, withFileLock, writeFileAtomic } from '../storage'
import { mergeConfig, normalizeStoredConfig } from './merge'
import type { ConfigManager, StoredConfig } from './types'

/* 锁参数:同一目录下的多进程共用同一套等待策略 */
const LOCK_OPTIONS = { ttlMs: STORAGE_LOCK_TTL_MS, retries: STORAGE_LOCK_RETRIES, backoffMs: STORAGE_LOCK_BACKOFF_MS }

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
  /* 串行化本进程内的写操作 */
  private writeQueue: Promise<unknown> = Promise.resolve()
  /* 上次读到的文件内容与其 mtime:作为合并基线并用于检测外部改动 */
  private lastKnown: StoredConfig | null = null
  private mtime: number | null = null

  async load(): Promise<StoredConfig | null> {
    const path = configPath()
    const file = await readJsonFileState(path)
    const current = normalizeStoredConfig(file.value)
    if (current === null) {
      /* 旧结构交给写入路径在锁内归档并迁移; 损坏或结构未知同样由写入路径归档 */
      const migrated = migrateStoredConfig(file.value)
      if (migrated !== null) return this.save(migrated)
    }
    this.lastKnown = current
    this.mtime = await fileMtime(path)
    return current
  }

  save(config: StoredConfig): Promise<StoredConfig> {
    const task = this.writeQueue.then(async () => {
      const dir = resolveConfigDir()
      const path = configPath()
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const merged = await withFileLock(join(dir, CONFIG_LOCK_FILE_NAME), LOCK_OPTIONS, async () => {
        /* 持锁后重读:其它进程可能刚写入过凭证或改过设置;
           旧结构或损坏文件在锁内归档(重命名)后再按迁移结果合并 */
        const file = await readJsonFileState(path)
        if (file.state === 'unreadable') return config
        let disk = normalizeStoredConfig(file.value)
        if (disk === null) {
          const migrated = migrateStoredConfig(file.value)
          if (migrated !== null) {
            /* 归档失败就不写: 否则旧凭证备份会被覆盖成新结构, 失去回滚余地 */
            if (!(await archiveFile(path, 'v2'))) throw new Error('failed to archive legacy config file')
            disk = migrated
          } else if (file.state !== 'missing') {
            if (!(await archiveFile(path, 'corrupt'))) throw new Error('failed to archive unreadable config file')
            disk = null
          }
        }
        const result = mergeConfig(disk ?? this.lastKnown, config)
        await writeFileAtomic(path, JSON.stringify(result, null, 2))
        this.lastKnown = result
        this.mtime = await fileMtime(path)
        return result
      })
      await hardenPathPermissions(dir, path)
      return merged
    })
    this.writeQueue = task.catch(() => {})
    /* 写失败时退回本次期望值:内存态继续可用, 下次写入再合并 */
    return task.catch(() => config)
  }

  async refresh(): Promise<StoredConfig | null> {
    const path = configPath()
    const mtime = await fileMtime(path)
    if (mtime === null || mtime === this.mtime) return null
    const file = await readJsonFileState(path)
    if (file.state === 'unreadable') return null
    const disk = normalizeStoredConfig(file.value) ?? migrateStoredConfig(file.value)
    this.mtime = mtime
    if (!disk) {
      /* 损坏或结构未知: 归档留痕, 本次按无配置处理 */
      if (file.state !== 'missing') await archiveFile(path, 'corrupt')
      return null
    }
    /* 按变更时刻合并:外部新增的凭证与本次内存变化都要保留 */
    const merged = this.lastKnown === null ? disk : mergeConfig(disk, this.lastKnown)
    this.lastKnown = merged
    return merged
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

export type { ConfigManager, StoredConfig, StoredCredential, StoredSettings } from './types'
