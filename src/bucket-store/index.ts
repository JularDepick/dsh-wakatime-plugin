/*
 * 分凭证数据桶持久化
 * 作者: JularDepick
 *
 * 每份凭证一份本地数据(本地战绩累计、该凭证的云端快照、待发送队列、
 * 失败任务与上报记录),统一落盘在凭证目录的 BUCKET_FILE_NAME(与配置文件同目录、
 * 同权限收紧);未配置凭证期间的数据落在未指派桶,由此后首个配置的凭证认领。
 * 桶标识取凭证原文的 sha256 摘要前 16 位,桶内另存展示用模糊凭证(首尾各 8 字符,
 * 其余以 * 代替),两者都不含凭证明文。
 *
 * 多进程(同一目录被多个 dsh profile 共用)落盘策略:
 * - 互斥:flush 前抢文件锁(O_EXCL), 持锁期间完成读-改-写;
 * - 原子:写入走临时文件 + rename;
 * - 合并:以磁盘为基底叠加本进程增量(见 merge.ts), 累计量两侧都不丢;
 * - 读侧:reloadIfChanged() 按 mtime 检测其它进程写入并并入内存;
 * - 删除:记墓碑(tombstones), 已删除的桶不会被其它进程复活。
 * 本模块不自动清除任何桶:非当前凭证且超过 BUCKET_STALE_DAYS 未更新的桶
 * 只被标记为"可由用户移除"(判定交给界面与 Web 后端,删除动作由用户触发)。
 * 首次升级时把旧版独立快照(stats.json / heartbeats.json)一次性并入当前桶。
 */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BUCKET_FILE_NAME,
  BUCKET_FILE_VERSION,
  BUCKET_LOCK_FILE_NAME,
  BUCKET_SAVE_DEBOUNCE_MS,
  BUCKET_STALE_DAYS,
  FAILED_TASK_LIMIT,
  LEGACY_HEARTBEAT_FILE_NAME,
  KEY_MASK_STARS,
  LEGACY_STATS_FILE_NAME,
  REPORT_LOG_LIMIT,
  STORAGE_LOCK_BACKOFF_MS,
  STORAGE_LOCK_RETRIES,
  STORAGE_LOCK_TTL_MS,
} from '../constants'
import { credentialIdOf } from '../auth/credential'
import { hardenPathPermissions, resolveConfigDir } from '../config-manager'
import { normalizePendingState } from '../heartbeat'
import type { PendingHeartbeatState } from '../heartbeat'
import { fileMtime, readJsonFile, withFileLock, writeFileAtomic } from '../storage'
import { emptyTotals, normalizeTotals } from '../stats'
import type { StatsTotals } from '../stats'
import type { CloudSummary } from '../sync'
import { isMergeSane, mergeBucketFiles } from './merge'
import { UNASSIGNED_BUCKET } from './types'
import type { BucketFile, DataBucket } from './types'

/* 锁参数:与配置文件共用同一套等待策略 */
const LOCK_OPTIONS = { ttlMs: STORAGE_LOCK_TTL_MS, retries: STORAGE_LOCK_RETRIES, backoffMs: STORAGE_LOCK_BACKOFF_MS }

/* 桶标识:与凭证标识同源(凭证原文的 sha256 摘要前 16 位, 文件内不出现明文) */
export function bucketKeyOf(secret: string): string {
  return credentialIdOf(secret)
}

/* 新建空桶 */
function emptyBucket(): DataBucket {
  return {
    updatedAt: 0,
    stats: emptyTotals(),
    cloud: null,
    pending: { queue: [], failed: [], report: [] },
  }
}

/* 空文件 */
function emptyFile(): BucketFile {
  return { version: BUCKET_FILE_VERSION, buckets: {}, tombstones: {} }
}

/* 深拷贝:基线必须与内存态完全隔离,否则累加会污染基线导致增量恒为 0 */
function cloneFile(file: BucketFile): BucketFile {
  return {
    version: file.version,
    buckets: JSON.parse(JSON.stringify(file.buckets)) as Record<string, DataBucket>,
    tombstones: { ...(file.tombstones ?? {}) },
  }
}

/* 云端快照归一化:字段缺失或非法时按 0,整体不可用时返回 null */
function normalizeCloud(value: unknown): CloudSummary | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const num = (key: string): number => {
    const field = raw[key]
    return typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : 0
  }
  return {
    syncedAt: num('syncedAt'),
    inputTokens: num('inputTokens'),
    outputTokens: num('outputTokens'),
    promptChars: num('promptChars'),
    sessions: num('sessions'),
    promptEvents: num('promptEvents'),
  }
}

/* 单个桶归一化:缺失字段按空值补齐,损坏内容不污染统计与上报 */
function normalizeBucket(value: unknown): DataBucket | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
    ? raw.updatedAt
    : 0
  const bucket: DataBucket = {
    updatedAt,
    stats: normalizeTotals(raw.stats),
    cloud: normalizeCloud(raw.cloud),
    pending: normalizePendingState(raw.pending),
  }
  /* 模糊凭证只接受受限长度与字符集的字符串(界面标识用,不参与任何请求) */
  if (typeof raw.accountId === 'string' && raw.accountId !== '') bucket.accountId = raw.accountId
  const masked = raw.maskedKey
  if (typeof masked === 'string' && masked.length > 0 && masked.length <= 128 && /^[A-Za-z0-9*_-]+$/.test(masked)) {
    /* 旧版按隐藏位数展开星号, 这里折叠成固定长度, 保持与新算法一致 */
    bucket.maskedKey = masked.replace(/\*{2,}/g, '*'.repeat(KEY_MASK_STARS))
  }
  return bucket
}

/* 文件归一化:非法桶整条丢弃;墓碑只接受有效时间戳 */
export function normalizeBucketFile(value: unknown): BucketFile {
  const file = emptyFile()
  if (typeof value !== 'object' || value === null) return file
  const raw = value as { buckets?: unknown, tombstones?: unknown }
  if (typeof raw.buckets === 'object' && raw.buckets !== null) {
    for (const [key, bucket] of Object.entries(raw.buckets as Record<string, unknown>)) {
      if (key === '') continue
      const normalized = normalizeBucket(bucket)
      if (normalized) file.buckets[key] = normalized
    }
  }
  if (typeof raw.tombstones === 'object' && raw.tombstones !== null) {
    const tombstones: Record<string, number> = {}
    for (const [key, ts] of Object.entries(raw.tombstones as Record<string, unknown>)) {
      if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) tombstones[key] = ts
    }
    file.tombstones = tombstones
  }
  return file
}

export class BucketStore {
  /* 初始读取完成前不写入,避免启动瞬间用空文件覆盖历史数据 */
  private ready = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private data: BucketFile = emptyFile()
  /* 上次与磁盘对齐的内容:合并时作为本进程增量基线 */
  private baseline: BucketFile = emptyFile()
  /* 上次看到的文件 mtime:用于检测其它进程的写入 */
  private mtime: number | null = null

  /* 读取数据桶文件;文件不存在时尝试迁移旧版快照到当前桶 */
  async load(currentKey: string): Promise<void> {
    const path = this.path()
    const raw = await readJsonFile(path)
    if (raw === undefined) {
      this.data = emptyFile()
      await this.migrateLegacy(currentKey)
    } else {
      this.data = normalizeBucketFile(raw)
    }
    this.baseline = cloneFile(this.data)
    this.mtime = await fileMtime(path)
    this.ready = true
    this.scheduleSave()
  }

  /* 检测其它进程是否写入过数据:有变化时并入内存(磁盘为基底 + 本进程增量),返回是否变更 */
  async reloadIfChanged(): Promise<boolean> {
    const path = this.path()
    const mtime = await fileMtime(path)
    if (mtime === null || mtime === this.mtime) return false
    const raw = await readJsonFile(path)
    this.mtime = mtime
    if (raw === undefined) return false
    const disk = normalizeBucketFile(raw)
    this.data = mergeBucketFiles(disk, this.data, this.baseline)
    /* 基线对齐到磁盘:保留"本进程未落盘增量"作为下次合并的差额 */
    this.baseline = disk
    return true
  }

  /* 取桶(不存在则创建;不落 updatedAt,由写入方触发) */
  ensure(key: string): DataBucket {
    let bucket = this.data.buckets[key]
    if (!bucket) {
      bucket = emptyBucket()
      this.data.buckets[key] = bucket
    }
    return bucket
  }

  /* 全部桶(含未指派桶) */
  buckets(): Readonly<Record<string, DataBucket>> {
    return this.data.buckets
  }

  /* 写入该桶所属账号标识(云端快照按账号去重时使用;空值表示未知账号) */
  setAccountId(key: string, accountId: string | null): void {
    const bucket = this.ensure(key)
    const next = accountId === null || accountId === '' ? undefined : accountId
    if (bucket.accountId === next) return
    bucket.accountId = next
    bucket.updatedAt = Date.now()
    this.scheduleSave()
  }

  /* 写入本地战绩累计量(绝对累计值,合并时与本进程基线做差得到增量) */
  setStats(key: string, totals: StatsTotals): void {
    this.touch(key).stats = totals
  }

  /* 写入该凭证的云端快照 */
  setCloud(key: string, cloud: CloudSummary | null): void {
    this.touch(key).cloud = cloud
  }

  /* 写入待发送状态 */
  setPending(key: string, pending: PendingHeartbeatState): void {
    this.touch(key).pending = pending
  }

  /* 认领未指派桶:把未登录期间的数据并入目标凭证的桶并删除未指派桶(记墓碑防止复活) */
  claimUnassigned(targetKey: string): boolean {
    const source = this.data.buckets[UNASSIGNED_BUCKET]
    if (!source) return false
    const target = this.touch(targetKey)
    const stats = { ...target.stats }
    for (const key of Object.keys(stats) as (keyof StatsTotals)[]) {
      stats[key] = (target.stats[key] ?? 0) + (source.stats[key] ?? 0)
    }
    target.stats = stats
    target.cloud = target.cloud ?? source.cloud
    target.pending = {
      queue: [...source.pending.queue, ...target.pending.queue],
      failed: [...source.pending.failed, ...target.pending.failed].slice(-FAILED_TASK_LIMIT),
      report: [...source.pending.report, ...target.pending.report].slice(-REPORT_LOG_LIMIT),
    }
    target.updatedAt = Math.max(target.updatedAt, source.updatedAt)
    delete this.data.buckets[UNASSIGNED_BUCKET]
    this.markDeleted(UNASSIGNED_BUCKET)
    this.scheduleSave()
    return true
  }

  /* 该桶是否已超过静默期(非当前凭证且 BUCKET_STALE_DAYS 天未更新);仅作界面判定,不自动删除 */
  isStale(key: string, now: number = Date.now()): boolean {
    const bucket = this.data.buckets[key]
    if (!bucket) return false
    const deadline = now - BUCKET_STALE_DAYS * 24 * 60 * 60 * 1000
    return bucket.updatedAt < deadline
  }

  /* 移除一个数据桶(用户手动触发;调用方负责校验是否允许移除);返回是否存在 */
  removeBucket(key: string): boolean {
    if (key === UNASSIGNED_BUCKET) return false
    if (!this.data.buckets[key]) return false
    delete this.data.buckets[key]
    this.markDeleted(key)
    this.scheduleSave()
    return true
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
        const disk = raw === undefined ? emptyFile() : normalizeBucketFile(raw)
        const merged = mergeBucketFiles(disk, this.data, this.baseline)
        /* 自检:合并不得让已有桶消失或累计量变小,异常时放弃本次写入 */
        if (!isMergeSane(disk, merged)) return
        await writeFileAtomic(path, JSON.stringify(merged, null, 2))
        this.data = merged
        this.baseline = cloneFile(merged)
        this.mtime = await fileMtime(path)
      })
      await hardenPathPermissions(dir, path)
    } catch {
      /* 尽力而为:落盘失败不影响统计与上报 */
    }
  }

  /* 取桶并刷新最后更新时刻 */
  private touch(key: string): DataBucket {
    const bucket = this.ensure(key)
    bucket.updatedAt = Date.now()
    this.scheduleSave()
    return bucket
  }

  /* 记录删除墓碑:多个进程合并时删除状态优先,避免已删除的桶被复活 */
  private markDeleted(key: string): void {
    const tombstones = this.data.tombstones ?? {}
    tombstones[key] = Date.now()
    this.data.tombstones = tombstones
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

  /* 旧版独立快照迁移:stats.json(全局累计量)与 heartbeats.json(待发送状态)并入当前桶 */
  private async migrateLegacy(currentKey: string): Promise<void> {
    const dir = resolveConfigDir()
    let migrated = false
    try {
      const totals = normalizeTotals(JSON.parse(await readFile(join(dir, LEGACY_STATS_FILE_NAME), 'utf-8')))
      const bucket = this.ensure(currentKey)
      bucket.stats = totals
      bucket.updatedAt = Date.now()
      migrated = true
    } catch {
      /* 无旧版累计量快照 */
    }
    try {
      const pending = normalizePendingState(JSON.parse(await readFile(join(dir, LEGACY_HEARTBEAT_FILE_NAME), 'utf-8')))
      const bucket = this.ensure(currentKey)
      bucket.pending = pending
      bucket.updatedAt = Date.now()
      migrated = true
    } catch {
      /* 无旧版待发送快照 */
    }
    if (migrated) this.scheduleSave()
  }
}

export { UNASSIGNED_BUCKET } from './types'
export type { BucketFile, DataBucket } from './types'
export { resolveStatsView } from './resolve'
export type { StatsView } from './resolve'
