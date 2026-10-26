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
import { fileMtime, readJsonFile, withFileLock, writeFileAtomic } from '../storage'
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

export class LocalStore {
  /* 初始读取完成前不写入,避免启动瞬间用空文件覆盖历史数据 */
  private ready = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private data: StoreFile = emptyStore()
  /* 上次与磁盘对齐的内容:合并时作为本进程增量基线 */
  private baseline: StoreFile = emptyStore()
  /* 上次看到的文件 mtime:用于检测其它进程的写入 */
  private mtime: number | null = null

  /* 读取数据文件;旧结构经 migrate 转换, 更早的独立快照在文件缺失时并入 */
  async load(): Promise<void> {
    const path = this.path()
    const raw = await readJsonFile(path)
    let data = normalizeStore(raw)
    if (data === null) {
      data = migrateStoreFile(raw) ?? await loadLegacySnapshots(resolveConfigDir()) ?? emptyStore()
    }
    this.data = data
    this.baseline = cloneStore(data)
    this.mtime = await fileMtime(path)
    this.ready = true
    /* 迁移或首建时把当前结构写回磁盘 */
    this.scheduleSave()
  }

  /* 检测其它进程是否写入过数据:有变化时并入内存,返回是否变更 */
  async reloadIfChanged(): Promise<boolean> {
    const path = this.path()
    const mtime = await fileMtime(path)
    if (mtime === null || mtime === this.mtime) return false
    const raw = await readJsonFile(path)
    this.mtime = mtime
    const disk = normalizeStore(raw) ?? migrateStoreFile(raw)
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

  /* 云端快照 */
  cloud(): CloudSummary | null {
    return this.data.cloud
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
        const raw = await readJsonFile(path)
        const disk = normalizeStore(raw) ?? migrateStoreFile(raw) ?? emptyStore()
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
