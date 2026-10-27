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
  STORE_FILE_VERSION,
} from '../constants'
import { hardenPathPermissions, resolveConfigDir } from '../config-manager'
import type { PendingHeartbeatState } from '../heartbeat'
import { archiveLegacySnapshots, loadLegacySnapshots, migrateStoreFile } from '../migrate'
import { archiveFile, fileMtime, readJsonFileState, withFileLock, writeFileAtomic } from '../storage'
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
  /* 数据文件读不出(权限/占用)时禁止写盘, 本进程只做统计与上报 */
  private writeBlocked = false

  constructor(options: LocalStoreOptions = {}) {
    this.options = options
  }

  /* 读取数据文件;旧结构经 migrate 转换, 更早的独立快照在文件缺失时并入.
     旧结构、损坏或结构未知的文件由落盘路径先归档再重建, 不会静默覆盖;
     读取失败(权限/占用)时按空数据运行且不写盘, 避免覆盖读不出的文件 */
  async load(): Promise<void> {
    const path = this.path()
    const file = await readJsonFileState(path)
    let data = normalizeStore(file.value)
    let needsRewrite = false
    /* 数据来自更早版本的独立快照:磁盘上没有数据文件,基线应保持为空,
       让并入的旧数据整体作为增量写回;若把基线设成并入结果,增量恒为 0,
       落盘时会被算成全零空桶,旧战绩与旧队列等于被清零 */
    let fromLegacy = false
    /* 数据文件版本高于本插件支持的版本(降级并存或未来版本):不认识而非损坏,
       一律只读运行并禁止写盘, 绝不归档重建, 否则旧数据会被直接抹掉 */
    const rawVersion = typeof file.value === 'object' && file.value !== null
      ? (file.value as Record<string, unknown>).version
      : undefined
    const futureVersion = typeof rawVersion === 'number' && Number.isFinite(rawVersion) && rawVersion > STORE_FILE_VERSION
    if (data === null && futureVersion) {
      this.writeBlocked = true
      this.options.logger?.warn?.(
        `[wakatime] data file version ${rawVersion} is newer than supported ${STORE_FILE_VERSION}, persistence disabled this run`,
      )
    }
    if (data === null && !futureVersion) {
      const migrated = migrateStoreFile(file.value)
      if (migrated !== null) {
        data = migrated
        needsRewrite = true
      } else {
        const legacy = await loadLegacySnapshots(resolveConfigDir())
        if (legacy !== null) {
          data = legacy
          needsRewrite = true
          fromLegacy = true
        } else {
          if (file.state === 'unreadable') {
            this.writeBlocked = true
            this.options.logger?.warn?.('[wakatime] data file is not readable, persistence disabled this run')
          } else if (file.state !== 'missing') {
            this.options.logger?.warn?.('[wakatime] data file not recognized, will be archived and recreated')
            needsRewrite = true
          }
          data = emptyStore()
        }
      }
    }
    if (data === null) data = emptyStore()
    this.data = data
    /* 来自旧快照时基线留空(全部数据都算增量),其余情况基线对齐内存 */
    this.baseline = fromLegacy ? emptyStore() : cloneStore(data)
    this.mtime = await fileMtime(path)
    this.ready = true
    /* 旧结构或无法识别的文件立即归档重建(不等防抖窗口);其余按防抖写回 */
    if (needsRewrite) {
      await this.flush()
      /* 旧快照并入成功后归档: 只留一次并入痕迹, 下次启动不会重复并入 */
      if (fromLegacy) await archiveLegacySnapshots(resolveConfigDir())
      return
    }
    this.scheduleSave()
  }

  /* 检测其它进程是否写入过数据:有变化时并入内存,返回是否变更 */
  async reloadIfChanged(): Promise<boolean> {
    const path = this.path()
    const mtime = await fileMtime(path)
    if (mtime === null || mtime === this.mtime) return false
    const file = await readJsonFileState(path)
    this.mtime = mtime
    if (file.state === 'unreadable') return false
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

  /* 立即落盘(卸载时调用);持锁读-改-写,失败只告警,不影响插件运行 */
  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (!this.ready || this.writeBlocked) return
    const dir = resolveConfigDir()
    const path = this.path()
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await withFileLock(join(dir, BUCKET_LOCK_FILE_NAME), LOCK_OPTIONS, async () => {
        const file = await readJsonFileState(path)
        if (file.state === 'unreadable') {
          /* 读不出就不能写: 否则 rename 会把读不出的内容覆盖成空 */
          this.options.logger?.warn?.('[wakatime] data file is not readable, skip writing')
          return
        }
        let disk = normalizeStore(file.value)
        if (disk === null) {
          const migrated = migrateStoreFile(file.value)
          if (migrated !== null) {
            /* 旧结构: 归档原文件后再写入新结构 */
            await archiveFile(path, 'v2')
            disk = migrated
          }
          else if (file.state === 'missing') disk = emptyStore()
          else {
            /* 损坏或结构未知: 先归档(重命名)再重建, 归档后原路径已不存在, 本次可正常写入 */
            const tag = file.state === 'corrupt' ? 'corrupt' : 'unknown'
            const archived = await archiveFile(path, tag)
            this.options.logger?.warn?.(`[wakatime] data file archived as *.${tag}.*.bak, recreating`)
            if (!archived) return
            disk = emptyStore()
          }
        }
        const merged = mergeStore(disk, this.data, this.baseline, (scope, count) => {
          this.options.logger?.warn?.(`[wakatime] data file ${scope} overflow, ${count} entries dropped`)
        })
        /* 自检:合并不得让累计量变小,异常时放弃本次写入 */
        if (!isMergeSane(disk, merged)) {
          this.options.logger?.warn?.('[wakatime] merged data looks smaller than disk, skip writing')
          return
        }
        await writeFileAtomic(path, JSON.stringify(merged, null, 2))
        this.data = merged
        this.baseline = cloneStore(merged)
        this.mtime = await fileMtime(path)
      })
      await hardenPathPermissions(dir, path)
    } catch (error) {
      /* 落盘失败(锁超时/只读目录/磁盘满)时明确告警: 静默会让"数据没保存"变成无痕故障 */
      const reason = error instanceof Error ? error.message : String(error)
      this.options.logger?.warn?.(`[wakatime] failed to persist data file: ${reason}`)
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
