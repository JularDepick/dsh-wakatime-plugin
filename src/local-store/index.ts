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

import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BUCKET_FILE_NAME,
  BUCKET_LOCK_FILE_NAME,
  BUCKET_SAVE_DEBOUNCE_MS,
  PERSIST_RETRY_BASE_MS,
  PERSIST_RETRY_MAX_MS,
  STORAGE_LOCK_BACKOFF_MS,
  STORAGE_LOCK_RENEW_MS,
  STORAGE_LOCK_RETRIES,
  STORAGE_LOCK_TTL_MS,
  STORE_FILE_VERSION,
} from '../constants'
import { hardenPathPermissions, resolveConfigDir } from '../config-manager'
import type { PendingHeartbeatState } from '../heartbeat'
import { archiveLegacySnapshots, loadLegacySnapshots, migrateStoreFile } from '../migrate'
import { archiveFileWithPath, cleanupStaleTempFiles, fileMtime, readJsonFileState, withFileLock, writeFileAtomic } from '../storage'
import type { StatsTotals } from '../stats'
import type { CloudSummary } from '../sync'
import { mergeStore } from './merge'
import { emptyStore, normalizeStore } from './normalize'
import type { StoreFile } from './types'

/* 锁参数:与配置文件共用同一套等待策略 */
const LOCK_OPTIONS = { ttlMs: STORAGE_LOCK_TTL_MS, retries: STORAGE_LOCK_RETRIES, backoffMs: STORAGE_LOCK_BACKOFF_MS, renewMs: STORAGE_LOCK_RENEW_MS }

/* 深拷贝:基线必须与内存态完全隔离,否则累加会污染基线导致增量恒为 0 */
function cloneStore(file: StoreFile): StoreFile {
  return JSON.parse(JSON.stringify(file)) as StoreFile
}

/* 数据文件的结构版本是否高于本插件支持的版本(降级并存或未来版本):
   这类文件不认识而非损坏, 读、写、重载三条路径都要拦住, 否则归档重建会直接抹掉旧数据 */
function isFutureVersion(value: unknown): boolean {
  const version = typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>).version
    : undefined
  return typeof version === 'number' && Number.isFinite(version) && version > STORE_FILE_VERSION
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
  /* 在途迁移: 同一进程内并发点击复用同一次, 避免第二次把已转换的文件再归档一遍 */
  private migrating: Promise<StoreFile | null> | undefined
  /* 最近一次看到的磁盘内容: 只供读取侧合并展示, 不参与本进程的增量计算 */
  private diskView: StoreFile = emptyStore()
  /* 本进程主动作废云端快照(换凭证): 落盘必须写空, 否则会被其它进程的旧快照顶回来 */
  private cloudCleared = false
  /* 进程内串行化: 落盘与重载都要读写"内存态 + 基线", 并发执行会让旧盘内容覆盖新基线 */
  private ioChain: Promise<unknown> = Promise.resolve()
  /* 落盘失败后的重排间隔: 首次失败按基数起跳, 每次失败翻倍至上限, 成功落盘即复位 */
  private persistRetryDelay = 0

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
    /* 清掉被杀的进程留下的原子写临时文件(只删超过时限的, 不碰其它进程正在写的) */
    const removedTemps = await cleanupStaleTempFiles(path)
    if (removedTemps > 0) {
      this.options.logger?.warn?.(`[wakatime] removed ${removedTemps} stale temp files from data directory`)
    }
    let data = normalizeStore(file.value, (scope, count) => {
      this.options.logger?.warn?.(`[wakatime] data file ${scope} over limit on load, ${count} entries dropped`)
    })
    let needsRewrite = false
    /* 数据文件版本高于本插件支持的版本(降级并存或未来版本):不认识而非损坏,
       一律只读运行并禁止写盘, 绝不归档重建, 否则旧数据会被直接抹掉 */
    const futureVersion = isFutureVersion(file.value)
    if (data === null && futureVersion) {
      this.writeBlocked = true
      this.options.logger?.warn?.(
        `[wakatime] data file version is newer than supported ${STORE_FILE_VERSION}, persistence disabled this run`,
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
    this.diskView = cloneStore(data)
    this.mtime = await fileMtime(path)
    this.ready = true
    /* 无法识别的文件立即归档重建(不等防抖窗口);其余按防抖写回 */
    if (needsRewrite) {
      await this.flush()
      return
    }
    this.scheduleSave()
  }

  /* 检测其它进程是否写入过数据:有变化时更新读取侧视图,返回是否变更 */
  async reloadIfChanged(): Promise<boolean> {
    return this.serialize(() => this.reloadOnce())
  }

  /* reloadIfChanged 的执行体 */
  private async reloadOnce(): Promise<boolean> {
    const path = this.path()
    const mtime = await fileMtime(path)
    if (mtime === null) {
      /* 文件被删除(手工清理或重装): 只读标记与待迁移状态一并复位, 让下一次落盘重建文件,
         与配置侧"文件被删即复位"同口径 */
      if (this.mtime !== null) {
        this.writeBlocked = false
        this.legacy = null
        this.mtime = null
        this.scheduleSave()
      }
      return false
    }
    if (mtime === this.mtime) return false
    const file = await readJsonFileState(path)
    this.mtime = mtime
    if (file.state === 'unreadable') return false
    /* 运行期出现更高版本的文件(其它进程降级写入): 不认识, 只读并停止写盘, 绝不归档 */
    if (isFutureVersion(file.value)) {
      if (!this.writeBlocked) this.options.logger?.warn?.('[wakatime] data file is newer than supported, persistence disabled')
      this.writeBlocked = true
      return false
    }
    const disk = normalizeStore(file.value)
    if (disk === null) {
      /* 其它进程写回了旧结构(0.3.0 共存): 不自动转换, 转为待迁移状态并停止写盘 */
      if (migrateStoreFile(file.value) !== null || await loadLegacySnapshots(resolveConfigDir()) !== null) {
        this.legacy = migrateStoreFile(file.value) !== null ? 'store' : 'snapshots'
        this.writeBlocked = true
      }
      return false
    }
    /* 只更新读取侧视图, 不动内存态与基线: 若把合并结果写回内存, 其它进程的累计量会被当成
       本进程的增量再累加一次; 若把基线抬到磁盘内容, 本进程自己的增量会在下次合并时被裁成 0 */
    this.diskView = disk
    /* 磁盘内容回到当前结构: 解除只读标记与待迁移状态(其它进程可能已迁移过),
       否则 writeBlocked=false 而 legacy 仍在会让防抖落盘一直被跳过 */
    this.writeBlocked = false
    this.legacy = null
    return true
  }

  /* 当前数据快照(只读):磁盘内容 + 本进程未落盘增量, 供界面与工具展示 */
  snapshot(): StoreFile {
    return this.view()
  }

  /* 本地战绩累计量 */
  stats(): StatsTotals {
    return this.view().stats
  }

  /* 待发送状态 */
  pending(): PendingHeartbeatState {
    return this.view().pending
  }

  /* 读取侧合并视图: 合并结果不写回内存, 每次读取现算 */
  private view(): StoreFile {
    const merged = mergeStore(this.diskView, this.data, this.baseline)
    if (this.cloudCleared) merged.cloud = null
    return merged
  }

  /* 写入本地战绩累计量(绝对累计值,合并时与本进程基线做差得到增量) */
  setStats(totals: StatsTotals): void {
    this.data.stats = totals
    this.touch()
  }

  /* 写入云端快照 */
  setCloud(cloud: CloudSummary | null): void {
    this.data.cloud = cloud
    /* 主动清空必须记成"作废": 只让本进程没有快照的话, 合并时会从磁盘把旧账号的快照读回来 */
    this.cloudCleared = cloud === null
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

  /* 数据侧是否只读运行(结构版本更高/读不出/待迁移时禁止写盘): 界面据此提示,
     否则"数字照常增长但退出即丢"对用户完全不可见 */
  isWriteBlocked(): boolean {
    return this.writeBlocked
  }

  /* 执行旧版数据迁移(界面确认后调用): 持锁把旧结构转换为当前结构, 并入本进程运行期增量后写盘,
     原文件按来源归档为 *.v2.*.bak / *.legacy.*.bak;
     成功返回旧数据的战绩与待发送状态(供调用方回灌 StatsTracker 与推送引擎), 失败或无事可做返回 null.
     并发与失败处理: 同一进程内复用同一次迁移; 已落到当前结构就不再归档(否则会把正常数据改名);
     归档后写盘失败时把原文件改回去, 不留"原路径消失"的空洞 */
  async migrateLegacy(): Promise<StoreFile | null> {
    if (this.legacy === null) return null
    /* 同一进程内并发调用(两个标签各点一次)复用同一次迁移 */
    if (this.migrating !== undefined) return this.migrating
    const task = this.runMigration()
    this.migrating = task
    try {
      return await task
    } finally {
      this.migrating = undefined
    }
  }

  /* migrateLegacy 的实际执行体(持锁读-改-写) */
  private async runMigration(): Promise<StoreFile | null> {
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
        /* 结构版本高于本插件: 与 flushOnce 同口径, 只读且绝不覆盖.
           缺这道闸门时, 旧快照迁移会把另一个更新版本进程写下的文件无备份覆盖成当前结构 */
        if (isFutureVersion(file.value)) {
          this.writeBlocked = true
          this.options.logger?.warn?.('[wakatime] data file is newer than supported, migration aborted')
          return null
        }
        /* 磁盘已是当前结构(其它进程先迁移过): 直接并入内存, 不再转换、也不再归档 */
        const current = normalizeStore(file.value)
        const converted = current === null ? migrateStoreFile(file.value) : null
        const fromSnapshots = current === null && converted === null
        const legacy = current ?? converted ?? await loadLegacySnapshots(dir)
        if (legacy === null) {
          this.options.logger?.warn?.('[wakatime] no legacy data found, nothing to migrate')
          return null
        }
        /* 旧数据为基底, 叠加本进程运行期的增量(迁移前采集的心跳不丢) */
        const merged = mergeStore(legacy, this.data, this.baseline)
        /* 目标路径上确实有文件且不是当前结构时先归档: 旧结构标 v2, 无法识别的标 unknown.
           旧快照迁移同样要归档 —— 只按来源分支判断会把现有文件无备份覆盖掉;
           已归档表示旧文件被挪走, 调用方据此回滚 */
        let archivedPath: string | null = null
        if (current === null && file.state !== 'missing') {
          archivedPath = await archiveFileWithPath(path, converted === null ? 'unknown' : 'v2')
          if (archivedPath === null) {
            this.options.logger?.warn?.('[wakatime] failed to archive existing data file, migration aborted')
            return null
          }
        }
        try {
          await writeFileAtomic(path, JSON.stringify(merged, null, 2))
        } catch (error) {
          /* 写盘失败时把归档的旧文件改回去: 否则原路径不存在, 下次启动按空数据起步, 迁移入口也不再出现 */
          if (archivedPath !== null) {
            const restored = await rename(archivedPath, path).then(() => true, () => false)
            if (!restored) this.options.logger?.warn?.('[wakatime] failed to restore archived data file, original bytes remain in the .bak file')
          }
          throw error
        }
        if (fromSnapshots) await archiveLegacySnapshots(dir)
        this.data = merged
        this.baseline = cloneStore(this.data)
        this.diskView = merged
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
    return this.serialize(() => this.flushOnce())
  }

  /* flush 的执行体(持锁读-改-写) */
  private async flushOnce(): Promise<boolean> {
    /* 只短路"尚未载入": 不能在入口按 writeBlocked 短路, 否则锁内的"回到可识别结构即复位"
       永远执行不到, 一次瞬时读失败就会让本进程终身只读 */
    if (!this.ready) return false
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
        if (isFutureVersion(file.value)) {
          /* 更高版本的文件不能被当成"结构未知"归档重建 */
          this.writeBlocked = true
          this.options.logger?.warn?.('[wakatime] data file is newer than supported, skip writing')
          return false
        }
        /* 文件已回到可识别状态(或已被删除): 解除上次的只读标记.
           只置位不复位时, 一次瞬时读失败(占用/ACL)会让本进程终身不落盘, 界面数字照涨, 退出即丢 */
        this.writeBlocked = false
        let disk = normalizeStore(file.value)
        let archivedPath: string | null = null
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
            /* 损坏或结构未知: 先归档(重命名)再重建. 归档失败不写;
               归档成功但随后写盘失败时要把原文件改回去, 否则原路径留下空洞 */
            const tag = file.state === 'corrupt' ? 'corrupt' : 'unknown'
            archivedPath = await archiveFileWithPath(path, tag)
            if (archivedPath === null) {
              this.options.logger?.warn?.(`[wakatime] failed to archive unrecognized data file as *.${tag}.*.bak, skip writing`)
              return false
            }
            this.options.logger?.warn?.(`[wakatime] data file archived as *.${tag}.*.bak, recreating`)
            disk = emptyStore()
          }
        }
        /* 写盘期间采集面仍会改写内存态: 先拍一份快照, 合并结果与基线都用它.
           若改为 await 之后再拍基线, 窗口内到达的增量只被基线吸收而从未写盘,
           下次差值为 0, 这部分数据永久丢失 */
        const snapshot = cloneStore(this.data)
        const merged = mergeStore(disk, snapshot, this.baseline, (scope, count) => {
          this.options.logger?.warn?.(`[wakatime] data file ${scope} overflow, ${count} entries dropped`)
        })
        /* 本进程主动作废了云端快照: 落盘写空, 不能让磁盘上另一进程的旧账号快照留下来 */
        if (this.cloudCleared) merged.cloud = null
        try {
          await writeFileAtomic(path, JSON.stringify(merged, null, 2))
        } catch (error) {
          if (archivedPath !== null) {
            const restored = await rename(archivedPath, path).then(() => true, () => false)
            if (!restored) {
              this.options.logger?.warn?.('[wakatime] failed to restore archived data file, original bytes remain in the .bak file')
            }
          }
          throw error
        }
        /* 基线只吸收本进程写出去的那份视图: 若抬到合并结果, 其它进程的累计量会被算进基线,
           本进程(内存里没有那部分)的增量立刻变成负数被裁成 0, 并发 profile 下战绩会持续丢失 */
        this.baseline = snapshot
        this.diskView = merged
        this.cloudCleared = false
        this.persistRetryDelay = 0
        this.mtime = await fileMtime(path)
        return true
      })
      await hardenPathPermissions(dir, path)
      return written
    } catch (error) {
      /* 落盘失败(锁超时/只读目录/磁盘满)时明确告警: 静默会让"数据没保存"变成无痕故障 */
      const reason = error instanceof Error ? error.message : String(error)
      this.options.logger?.warn?.(`[wakatime] failed to persist data file: ${reason}`)
      this.schedulePersistRetry()
      return false
    }
  }

  /* 落盘失败后的重排: 间隔按失败次数翻倍至上限, 一次成功落盘即复位.
     不加这一层时, 安静期只有下一次数据变更才会再落盘, 期间进程被杀就丢掉内存里的增量 */
  private schedulePersistRetry(): void {
    this.persistRetryDelay = this.persistRetryDelay === 0
      ? PERSIST_RETRY_BASE_MS
      : Math.min(this.persistRetryDelay * 2, PERSIST_RETRY_MAX_MS)
    if (this.timer !== undefined) return
    if (this.legacy !== null || this.writeBlocked) return
    this.timer = setTimeout(() => { void this.flush() }, this.persistRetryDelay)
    this.timer.unref?.()
  }

  /* 进程内串行化: 落盘与重载都会读写内存态与基线, 交叉执行会让旧盘内容覆盖新基线 */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.ioChain.then(task, task)
    this.ioChain = run.catch(() => {})
    return run
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
