/*
 * 本地数据持久化
 * 作者: JularDepick
 *
 * 全插件一份本地数据(战绩累计、云端快照、待发送队列、失败任务与上报记录),
 * 与凭证无关: 更换凭证只改变上报账号, 不改变本地数据.
 *
 * 多进程(同一目录被多个 dsh profile 共用)落盘策略:
 * - 互斥: flush 前抢文件锁(O_EXCL), 持锁期间完成读-改-写;
 * - 原子: 写入走临时文件 + rename;
 * - 合并: 以磁盘为基底叠加本进程增量(见 merge.ts), 累计量两侧都不丢;
 * - 读侧: reloadIfChanged() 按 mtime 检测其它进程写入并并入内存.
 * 旧结构(0.3.0 的分凭证数据桶与更早的独立快照)在 migrate 模块一次性转换.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BUCKET_FILE_NAME,
  BUCKET_LOCK_FILE_NAME,
  BUCKET_SAVE_DEBOUNCE_MS,
  STORAGE_LOCK_BACKOFF_MS,
  STORAGE_LOCK_RETRIES,
  STORAGE_LOCK_TTL_MS,
} from '../constants'
import { hardenPathPermissions, resolveConfigDir } from '../config-manager'
import type { PendingHeartbeatState } from '../heartbeat'
import { loadLegacySnapshots, migrateStoreFile } from '../migrate'
import { backupFile, fileMtime, readJsonFileState, withFileLock, writeFileAtomic } from '../storage'
import type { StatsTotals } from '../stats'
import type { CloudSummary } from '../sync'
import { isMergeSane, mergeStore } from './merge'
import { emptyStore, normalizeStore } from './normalize'
import type { StoreFile } from './types'

/* 锁参数:与配置文件共用同一套等待策略 */
const LOCK_OPTIONS = { ttlMs: STORAGE_LOCK_TTL_MS, retries: STORAGE_LOCK_RETRIES, backoffMs: STORAGE_LOCK_BACKOFF_MS }

/* 深拷贝:基线必须与内存态完全隔离,否则累加会污染基线导致增量恒为 0 */
function cloneStore(file: StoreFile): StoreFile {
  return JSON.parse(JSON.stringify(file)) as StoreFile
}

export interface LocalStoreOptions {
  /* 警告日志(数据文件无法识别时提示), 缺省时静默 */
  logger?: { warn?: (message: string) => void }
}

export class LocalStore {
  private readonly options: LocalStoreOptions
  /* 初始读取完成前不写入,避免启动瞬间用空文件覆盖历史数据 */
  private ready = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private data: StoreFile = emptyStore()
  /* 上次与磁盘对齐的内容:合并时作为本进程增量基线 */
  private baseline: StoreFile = emptyStore()
  /* 上次看到的文件 mtime:用于检测其它进程的写入 */
  private mtime: number | null = null

  constructor(options: LocalStoreOptions = {}) {
    this.options = options
  }

  /* 读取数据文件;旧结构经 migrate 转换, 更早的独立快照在文件缺失时并入.
     存在但无法识别的内容先备份再按空数据起步, 不会静默覆盖成空文件 */
  async load(): Promise<void> {
    const path = this.path()
    const file = await readJsonFileState(path)
    let data = normalizeStore(file.value)
    let migratedNow = false
    if (data === null) {
      const migrated = migrateStoreFile(file.value)
      if (migrated !== null) {
        /* 迁移前留底: 回退旧版本或并存运行时仍可人工找回原始结构 */
        await backupFile(path, 'v2.bak')
        data = migrated
        migratedNow = true
      } else {
        data = await loadLegacySnapshots(resolveConfigDir())
        if (data === null) {
          if (file.state !== 'missing') {
            /* 损坏或结构未知: 备份原文件后以空数据起步 */
            await backupFile(path, file.state === 'corrupt' ? 'corrupt.bak' : 'unknown.bak')
            this.options.logger?.warn?.('[wakatime] data file not recognized, backed up and started empty')
          }
          data = emptyStore()
        }
      }
    }
    this.data = data
    this.baseline = cloneStore(data)
    this.mtime = await fileMtime(path)
    this.ready = true
    /* 迁移结果立即落盘(不等防抖窗口);其余情况按防抖写回 */
    if (migratedNow) await this.flush()
    else this.scheduleSave()
  }

  /* 检测其它进程是否写入过数据:有变化时并入内存,返回是否变更 */
  async reloadIfChanged(): Promise<boolean> {
    const path = this.path()
    const mtime = await fileMtime(path)
    if (mtime === null || mtime === this.mtime) return false
    const file = await readJsonFileState(path)
    this.mtime = mtime
    const disk = normalizeStore(file.value) ?? migrateStoreFile(file.value)
    if (disk === null) return false
    this.data = mergeStore(disk, this.data, this.baseline)
    /* 基线对齐到磁盘:保留"本进程未落盘增量"作为下次合并的差额 */
    this.baseline = disk
    return true
  }

  /* 当前数据快照(只读) */
  snapshot(): StoreFile {
    return this.data
  }

  /* 本地战绩累计量 */
  stats(): StatsTotals {
    return this.data.stats
  }

  /* 待发送状态 */
  pending(): PendingHeartbeatState {
    return this.data.pending
  }

  /* 写入本地战绩累计量(绝对累计值,合并时与本进程基线做差得到增量) */
  setStats(totals: StatsTotals): void {
    this.data.stats = totals
    this.touch()
  }

  /* 写入云端快照 */
  setCloud(cloud: CloudSummary | null): void {
    this.data.cloud = cloud
    this.touch()
  }

  /* 写入待发送状态 */
  setPending(pending: PendingHeartbeatState): void {
    this.data.pending = pending
    this.touch()
  }

  /* 标记有变更并防抖落盘 */
  save(): void {
    this.scheduleSave()
  }

  /* 立即落盘(卸载时调用);持锁读-改-写,失败静默,不影响插件运行 */
  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (!this.ready) return
    const dir = resolveConfigDir()
    const path = this.path()
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await withFileLock(join(dir, BUCKET_LOCK_FILE_NAME), LOCK_OPTIONS, async () => {
        const file = await readJsonFileState(path)
        let disk = normalizeStore(file.value)
        if (disk === null) {
          const migrated = migrateStoreFile(file.value)
          if (migrated !== null) disk = migrated
          else if (file.state === 'missing') disk = emptyStore()
          else {
            /* 存在但读不出或结构未知: 放弃本次写入, 避免把可恢复内容覆盖成空 */
            return
          }
        }
        const merged = mergeStore(disk, this.data, this.baseline)
        /* 自检:合并不得让累计量变小,异常时放弃本次写入 */
        if (!isMergeSane(disk, merged)) return
        await writeFileAtomic(path, JSON.stringify(merged, null, 2))
        this.data = merged
        this.baseline = cloneStore(merged)
        this.mtime = await fileMtime(path)
      })
      await hardenPathPermissions(dir, path)
    } catch {
      /* 尽力而为:落盘失败不影响统计与上报 */
    }
  }

  /* 刷新最后更新时刻并排一次落盘 */
  private touch(): void {
    this.data.updatedAt = Date.now()
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (!this.ready) return
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => { void this.flush() }, BUCKET_SAVE_DEBOUNCE_MS)
    this.timer.unref?.()
  }

  private path(): string {
    return join(resolveConfigDir(), BUCKET_FILE_NAME)
  }
}

export type { StoreFile } from './types'
export { emptyStore, normalizeStore } from './normalize'
export { resolveStatsView } from './resolve'
export type { StatsView } from './resolve'
