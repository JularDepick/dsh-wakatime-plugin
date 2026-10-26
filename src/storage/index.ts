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

import { copyFile, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'

export interface LockOptions {
  /* 锁文件最长存活时长, 超过视为陈旧锁 */
  ttlMs: number
  /* 抢锁重试次数 */
  retries: number
  /* 退避基数(按尝试次数线性递增) */
  backoffMs: number
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

/* 持锁执行:抢不到锁时按退避重试, 清理陈旧锁 */
export async function withFileLock<T>(lockPath: string, options: LockOptions, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    let handle
    try {
      handle = await open(lockPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const age = await lockAge(lockPath)
      /* 陈旧锁:持有进程可能已异常退出, 清除后立刻重试 */
      if (age !== null && age > options.ttlMs) {
        await unlink(lockPath).catch(() => {})
        continue
      }
      if (attempt === options.retries) throw new Error('storage lock timeout')
      await sleep(options.backoffMs * (attempt + 1))
      continue
    }
    try {
      await handle.writeFile(`${process.pid} ${Date.now()}`)
    } finally {
      await handle.close().catch(() => {})
    }
    try {
      return await run()
    } finally {
      await unlink(lockPath).catch(() => {})
    }
  }
  throw new Error('storage lock timeout')
}

/* 原子写入:临时文件 + rename(同目录保证同一文件系统) */
export async function writeFileAtomic(path: string, text: string, mode = 0o600): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, text, { mode })
  await rename(temp, path)
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

/* 读取并解析 JSON;不存在或解析失败返回 undefined */
export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return undefined
  }
}

/* 读取状态: 区分"文件不存在"与"存在但读不出或不是合法 JSON",
   后者不能再被当成空数据覆盖(否则一次读失败就会把历史数据清零) */
export interface JsonFileState {
  state: 'missing' | 'ok' | 'corrupt'
  value?: unknown
}

export async function readJsonFileState(path: string): Promise<JsonFileState> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch {
    return { state: 'missing' }
  }
  try {
    return { state: 'ok', value: JSON.parse(text) as unknown }
  } catch {
    return { state: 'corrupt' }
  }
}

/* 备份一个文件为 <路径>.<后缀>(覆盖同名备份);失败静默, 不阻塞主流程 */
export async function backupFile(path: string, suffix: string): Promise<void> {
  try {
    await copyFile(path, `${path}.${suffix}`)
  } catch {
    /* 尽力而为 */
  }
}
