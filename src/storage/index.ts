/*
 * 跨进程存储原语:文件锁、原子写入与 mtime 读取
 * 作者: JularDepick
 *
 * 同一 OS 用户下的多个 dsh profile(desktop / web 等)共享同一份插件数据目录,
 * 各进程独立运行、各自防抖落盘, 因此写文件必须满足三点:
 * 1. 互斥: 以 O_EXCL 创建锁文件(内含 pid 与时间戳), 超过 TTL 视为陈旧锁并清除;
 * 2. 原子: 先写同目录临时文件再 rename, 避免读到写了一半的内容;
 * 3. 合并前重读: 调用方持锁期间重新读盘, 以磁盘为基底叠加本进程增量.
 */

import { randomUUID } from 'node:crypto'
import { readdir, stat, unlink } from 'node:fs/promises'
import { open, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { STALE_TEMP_MAX_AGE_MS } from '../constants'

export interface LockOptions {
  /* 锁文件最长存活时长, 超过视为陈旧锁 */
  ttlMs: number
  /* 抢锁重试次数 */
  retries: number
  /* 退避基数(按尝试次数线性递增) */
  backoffMs: number
  /* 持锁期间的续期间隔(刷新锁文件时间戳,避免长事务被判为陈旧锁) */
  renewMs: number
}

/* 等待若干毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/* 锁文件存活时长;不存在时返回 null */
async function lockAge(lockPath: string): Promise<number | null> {
  try {
    const info = await stat(lockPath)
    return Date.now() - info.mtimeMs
  } catch {
    return null
  }
}

/* 持锁执行:抢不到锁时按退避重试, 清理陈旧锁.
   锁文件内容是 "<pid> <时间戳> <随机令牌>": 续期与释放前都要确认内容仍是自己的令牌,
   否则进程被长时间阻塞(事件循环卡住超过 TTL)时会把别人刚建的锁当成自己的续期或删除,
   造成两个进程同时持锁、增量合并的互斥前提失效 */
export async function withFileLock<T>(lockPath: string, options: LockOptions, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    let handle
    try {
      handle = await open(lockPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const age = await lockAge(lockPath)
      /* 陈旧锁:持有进程可能已异常退出, 清除后立刻重试.
         stat 与 unlink 之间别的进程可能已清掉旧锁并建了新锁, 因此先把锁改名"认领"下来(rename 原子),
         再核对认领到的内容是否就是判陈旧时读到的那一把; 内容不符说明抢到的是别人刚建的新锁, 原样放回 */
      if (age !== null && age > options.ttlMs) {
        const content = await readFile(lockPath, 'utf-8').catch(() => null)
        if (content !== null) {
          const claimPath = `${lockPath}.stale.${process.pid}.${randomUUID().slice(0, 8)}`
          const claimed = await rename(lockPath, claimPath).then(() => true, () => false)
          if (claimed) {
            const claimedContent = await readFile(claimPath, 'utf-8').catch(() => null)
            if (claimedContent === content) {
              await unlink(claimPath).catch(() => {})
            } else {
              const restored = await rename(claimPath, lockPath).then(() => true, () => false)
              /* 放不回去说明原路径已被新锁占住, 认领到的这份是过期副本, 直接删掉 */
              if (!restored) await unlink(claimPath).catch(() => {})
            }
          }
        }
        continue
      }
      if (attempt === options.retries) throw new Error('storage lock timeout')
      await sleep(options.backoffMs * (attempt + 1))
      continue
    }
    const token = `${process.pid} ${Date.now()} ${randomUUID()}`
    try {
      await handle.writeFile(token)
    } catch (error) {
      /* 令牌没写成就不能留下空锁文件: 它会变成毒锁, 同目录所有写入都要等到 TTL 过期才能进 */
      await handle.close().catch(() => {})
      await unlink(lockPath).catch(() => {})
      throw error
    }
    await handle.close().catch(() => {})
    /* 持锁期间定时续期:只写一次时间戳时,长事务会被其它进程当成陈旧锁清掉,
       两个进程同时持锁会让增量合并的互斥前提失效; 续期前先确认锁仍是自己的 */
    let released = false
    let renewal: Promise<void> = Promise.resolve()
    const renew = setInterval(() => {
      renewal = renewal.then(async () => {
        if (released) return
        const current = await readFile(lockPath, 'utf-8').catch(() => null)
        if (current !== token) return
        await writeFile(lockPath, token)
      }).catch(() => {})
    }, options.renewMs)
    renew.unref?.()
    try {
      return await run()
    } finally {
      clearInterval(renew)
      /* 等在途的那次续期落定再释放: 否则它可能落在 unlink 之后, 把旧令牌的锁重新写出来 */
      released = true
      await renewal.catch(() => {})
      const current = await readFile(lockPath, 'utf-8').catch(() => null)
      if (current === token) await unlink(lockPath).catch(() => {})
    }
  }
  throw new Error('storage lock timeout')
}

/* 原子写入:临时文件 + rename(同目录保证同一文件系统).
   写临时文件与改名任一步失败都要清掉临时文件: 磁盘满时否则每次写入都会在数据目录留一个 .tmp */
export async function writeFileAtomic(path: string, text: string, mode = 0o600): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(temp, text, { mode })
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/* 清理原子写残留: 进程被杀会在数据目录留下 "<文件名>.<pid>.<时间戳>.<随机>.tmp",
   启动时只删除超过 STALE_TEMP_MAX_AGE_MS 的, 避免误删其它进程正在写的临时文件 */
export async function cleanupStaleTempFiles(path: string): Promise<number> {
  const dir = dirname(path)
  const prefix = basename(path) + '.'
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
    const temp = join(dir, name)
    try {
      const info = await stat(temp)
      if (Date.now() - info.mtimeMs < STALE_TEMP_MAX_AGE_MS) continue
      await unlink(temp)
      removed += 1
    } catch {
      /* 已被别的进程清理或无权访问: 跳过 */
    }
  }
  return removed
}

/* 文件 mtime;不存在或失败返回 null(用于检测其它进程的写入) */
export async function fileMtime(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.mtimeMs
  } catch {
    return null
  }
}

/* 读取状态: 区分"文件不存在"与"存在但读不出或不是合法 JSON",
   后者不能再被当成空数据覆盖(否则一次读失败就会把历史数据清零) */
export interface JsonFileState {
  /* missing 不存在 / ok 合法 / corrupt 解析失败 / unreadable 存在但读不出(权限或占用) */
  state: 'missing' | 'ok' | 'corrupt' | 'unreadable'
  value?: unknown
}

export async function readJsonFileState(path: string): Promise<JsonFileState> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch (error) {
    /* 只有"不存在"可以当作空数据处理; 权限或占用导致的读失败必须区分开,
       否则会把读不出的文件当成空文件覆盖掉 */
    const code = (error as NodeJS.ErrnoException).code
    return { state: code === 'ENOENT' ? 'missing' : 'unreadable' }
  }
  try {
    return { state: 'ok', value: JSON.parse(text) as unknown }
  } catch {
    return { state: 'corrupt' }
  }
}

/* 归档一个文件: 重命名为 <路径>.<标签>.<时间戳>.bak, 返回归档后的路径(失败返回 null).
   用重命名而不是复制, 归档后原路径不再存在, 后续写入可以正常建立新文件;
   时间戳后缀保证反复归档不会覆盖上一次的痕迹;
   返回路径让调用方能在后续写盘失败时把原文件改回去, 避免"归档成功、写入失败"留下空洞 */
export async function archiveFileWithPath(path: string, tag: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archived = `${path}.${tag}.${stamp}.bak`
  try {
    await rename(path, archived)
    return archived
  } catch {
    return null
  }
}

/* 归档并只关心成败(其余调用点沿用) */
export async function archiveFile(path: string, tag: string): Promise<boolean> {
  return (await archiveFileWithPath(path, tag)) !== null
}
