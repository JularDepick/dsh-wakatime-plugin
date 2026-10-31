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
  STORAGE_LOCK_RENEW_MS,
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
const LOCK_OPTIONS = { ttlMs: STORAGE_LOCK_TTL_MS, retries: STORAGE_LOCK_RETRIES, backoffMs: STORAGE_LOCK_BACKOFF_MS, renewMs: STORAGE_LOCK_RENEW_MS }

/* 深拷贝:基线必须与内存态完全隔离,否则累加会污染基线导致增量恒为 0 */
function cloneStore(file: StoreFile): StoreFile {
  return JSON.parse(JSON.stringify(file)) as StoreFile
}

export interface LocalStoreOptions {
  /* 警告日志(数据文件无法识别时提示), 缺省时静默 */
  logger?: { warn?: (message: string) => void }
}

/* 旧版数据来源: store 为 0.3.0 的分凭证数据桶, snapshots 为更早版本的独立快照 */
export type LegacySource = 'store' | 'snapshots'

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
  /* 检测到旧版数据(0.3.0 的分凭证数据桶或更早的独立快照): 不自动转换, 等界面确认后迁移 */
  private legacy: LegacySource | null = null

  constructor(options: LocalStoreOptions = {}) {
    this.options = options
  }

  /* 读取数据文件;0.3.0 的分凭证数据桶与更早版本的独立快照不再自动转换,
     只记下待迁移来源并转入只读(旧文件原样保留), 由界面上的迁移入口触发一次转换;
     损坏或结构未知的文件仍由落盘路径先归档再重建, 不会静默覆盖;
     读取失败(权限/占用)时按空数据运行且不写盘, 避免覆盖读不出的文件 */
  async load(): Promise<void> {
    const path = this.path()
    const file = await readJsonFileState(path)
    let data = normalizeStore(file.value)
    let needsRewrite = false
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
      /* 旧版数据不再自动迁移: 只标记待迁移并禁止写盘, 避免用户在不知情时旧结构被归档重写 */
      const store1 = migrateStoreFile(file.value)
      const snapshots = store1 === null ? await loadLegacySnapshots(resolveConfigDir()) : null
      if (store1 !== null || snapshots !== null) {
        this.legacy = store1 !== null ? 'store' : 'snapshots'
        this.writeBlocked = true
        this.options.logger?.warn?.(
          `[wakatime] legacy ${this.legacy} data detected, persistence disabled until migration is confirmed in the Web UI`,
        )
      } else if (file.state === 'unreadable') {
        this.writeBlocked = true
        this.options.logger?.warn?.('[wakatime] data file is not readable, persistence disabled this run')
      } else if (file.state !== 'missing') {
        this.options.logger?.warn?.('[wakatime] data file not recognized, will be archived and recreated')
        needsRewrite = true
      }
      data = emptyStore()
    }
    if (data === null) data = emptyStore()
    this.data = data
    this.baseline = cloneStore(data)
    this.mtime = await fileMtime(path)
    this.ready = true
    /* 无法识别的文件立即归档重建(不等防抖窗口);其余按防抖写回 */
    if (needsRewrite) {
      await this.flush()
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
    const disk = normalizeStore(file.value)
    if (disk === null) {
      /* 其它进程写回了旧结构(0.3.0 共存): 不自动转换, 转为待迁移状态并停止写盘 */
      if (migrateStoreFile(file.value) !== null || await loadLegacySnapshots(resolveConfigDir()) !== null) {
        this.legacy = migrateStoreFile(file.value) !== null ? 'store' : 'snapshots'
        this.writeBlocked = true
      }
      return false
    }
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

  /* 待迁移的旧版数据来源: 界面据此显示迁移提示; null 表示没有待迁移数据 */
  legacyStatus(): LegacySource | null {
    return this.legacy
  }

  /* 执行旧版数据迁移(界面确认后调用): 持锁把旧结构转换为当前结构, 并入本进程运行期增量后写盘,
     原文件按来源归档为 *.v2.*.bak / *.legacy.*.bak;
     成功返回旧数据的战绩与待发送状态(供调用方回灌 StatsTracker 与推送引擎), 失败或无事可做返回 null */
  async migrateLegacy(): Promise<StoreFile | null> {
    if (this.legacy === null) return null
    const dir = resolveConfigDir()
    const path = this.path()
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const result = await withFileLock(join(dir, BUCKET_LOCK_FILE_NAME), LOCK_OPTIONS, async () => {
        const file = await readJsonFileState(path)
        if (file.state === 'unreadable') {
          this.options.logger?.warn?.('[wakatime] data file is not readable, migration aborted')
          return null
        }
        /* 磁盘已是当前结构(其它进程先迁移过): 直接并入内存, 不再转换 */
        const current = normalizeStore(file.value)
        const converted = current ?? migrateStoreFile(file.value)
        const fromSnapshots = converted === null
        const legacy = converted ?? await loadLegacySnapshots(dir)
        if (legacy === null) {
          this.options.logger?.warn?.('[wakatime] no legacy data found, nothing to migrate')
          return null
        }
        /* 旧数据为基底, 叠加本进程运行期的增量(迁移前采集的心跳不丢) */
        const merged = mergeStore(legacy, this.data, this.baseline)
        if (!isMergeSane(legacy, merged)) {
          this.options.logger?.warn?.('[wakatime] merged data looks smaller than legacy, migration aborted')
          return null
        }
        /* 先归档(重命名)再写新结构: 归档失败就放弃, 避免旧数据被直接覆盖 */
        if (!fromSnapshots) {
          const archived = await archiveFile(path, 'v2')
          if (!archived) {
            this.options.logger?.warn?.('[wakatime] failed to archive legacy data file, migration aborted')
            return null
          }
        }
        await writeFileAtomic(path, JSON.stringify(merged, null, 2))
        if (fromSnapshots) await archiveLegacySnapshots(dir)
        this.data = merged
        this.baseline = cloneStore(merged)
        this.mtime = await fileMtime(path)
        this.legacy = null
        this.writeBlocked = false
        this.options.logger?.warn?.(`[wakatime] legacy data migrated (${merged.stats.heartbeats} heartbeats, ${merged.pending.queue.length} queued)` )
        return legacy
      })
      await hardenPathPermissions(dir, path)
      return result
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.options.logger?.warn?.(`[wakatime] failed to migrate legacy data: ${reason}`)
      return null
    }
  }

  /* 立即落盘(卸载时调用);持锁读-改-写,失败只告警,不影响插件运行
     返回是否确实写入成功: 调用方据此决定是否执行依赖落盘的动作(如归档旧快照) */
  async flush(): Promise<boolean> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (!this.ready || this.writeBlocked) return false
    const dir = resolveConfigDir()
    const path = this.path()
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const written = await withFileLock(join(dir, BUCKET_LOCK_FILE_NAME), LOCK_OPTIONS, async () => {
        const file = await readJsonFileState(path)
        if (file.state === 'unreadable') {
          /* 读不出就不能写: 否则 rename 会把读不出的内容覆盖成空 */
          this.options.logger?.warn?.('[wakatime] data file is not readable, skip writing')
          return false
        }
        let disk = normalizeStore(file.value)
        if (disk === null) {
          if (migrateStoreFile(file.value) !== null) {
            /* 旧结构一直存在: 未经界面确认不转换也不覆盖, 交由用户点击迁移 */
            this.legacy = 'store'
            this.writeBlocked = true
            this.options.logger?.warn?.('[wakatime] legacy data file found, writing skipped until migration is confirmed')
            return false
          }
          if (file.state === 'missing') disk = emptyStore()
          else {
            /* 损坏或结构未知: 先归档(重命名)再重建, 归档后原路径已不存在, 本次可正常写入 */
            const tag = file.state === 'corrupt' ? 'corrupt' : 'unknown'
            const archived = await archiveFile(path, tag)
            this.options.logger?.warn?.(`[wakatime] data file archived as *.${tag}.*.bak, recreating`)
            if (!archived) return false
            disk = emptyStore()
          }
        }
        const merged = mergeStore(disk, this.data, this.baseline, (scope, count) => {
          this.options.logger?.warn?.(`[wakatime] data file ${scope} overflow, ${count} entries dropped`)
        })
        /* 自检:合并不得让累计量变小,异常时放弃本次写入 */
        if (!isMergeSane(disk, merged)) {
          this.options.logger?.warn?.('[wakatime] merged data looks smaller than disk, skip writing')
          return false
        }
        await writeFileAtomic(path, JSON.stringify(merged, null, 2))
        this.data = merged
        this.baseline = cloneStore(merged)
        this.mtime = await fileMtime(path)
        return true
      })
      await hardenPathPermissions(dir, path)
      return written
    } catch (error) {
      /* 落盘失败(锁超时/只读目录/磁盘满)时明确告警: 静默会让"数据没保存"变成无痕故障 */
      const reason = error instanceof Error ? error.message : String(error)
      this.options.logger?.warn?.(`[wakatime] failed to persist data file: ${reason}`)
      return false
    }
  }

  /* 刷新最后更新时刻并排一次落盘 */
  private touch(): void {
    this.data.updatedAt = Date.now()
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (!this.ready) return
    /* 旧版数据待迁移期间不落盘(写盘会在旧文件上重建, 等于替用户做了迁移) */
    if (this.legacy !== null) return
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
