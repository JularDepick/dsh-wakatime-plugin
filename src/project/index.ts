/*
 * 项目与分支检测
 * 作者: JularDepick
 *
 * 采样基准为会话工作目录(调用方传入 session.header.cwd,缺省回退宿主进程 cwd):
 * - 项目名:优先 Git 仓库根目录名(向上逐级查找),否则取采样目录 basename
 * - 分支名:解析 Git 头文件,支持 .git 目录、.git 文件(worktree/submodule
 *   的 gitdir 指向)与 worktree 的 commondir 间接层
 * 仓库定位按目录永久缓存,分支结果按头文件路径做 TTL 缓存,避免每个事件同步读盘。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { BRANCH_CACHE_TTL_MS, GIT_DIR_NAME, GIT_ROOT_MAX_DEPTH } from '../constants'

/* 一次采样的项目与分支 */
export interface ProjectSample {
  project: string
  branch?: string
}

/* Git 定位结果:仓库根目录与头文件路径 */
interface GitLocation {
  root: string
  headPath: string
}

export class ProjectDetector {
  private readonly defaultCwd: string
  /* 采样目录 → Git 定位(仓库根在运行期不变,永久缓存) */
  private readonly locations = new Map<string, GitLocation | null>()
  /* 头文件路径 → 分支名与读取时刻(TTL 缓存,兼顾 checkout 变化与读盘开销) */
  private readonly branches = new Map<string, { value: string | undefined; at: number }>()

  constructor(cwd: string = process.cwd()) {
    this.defaultCwd = cwd
  }

  /* 项目名:优先 Git 仓库根目录名,否则采样目录 basename */
  project(cwd?: string): string {
    const dir = cwd ?? this.defaultCwd
    const location = this.locate(dir)
    return basename(location?.root ?? dir) || 'unknown'
  }

  /* 当前 Git 分支;非 Git 目录、detached HEAD 或头文件不可读时返回 undefined */
  branch(cwd?: string): string | undefined {
    const location = this.locate(cwd ?? this.defaultCwd)
    if (!location) return undefined
    const cached = this.branches.get(location.headPath)
    const now = Date.now()
    if (cached && now - cached.at < BRANCH_CACHE_TTL_MS) return cached.value
    const value = readBranch(location.headPath)
    this.branches.set(location.headPath, { value, at: now })
    return value
  }

  /* 一次性采样(需同时取项目与分支时使用,仓库定位只做一次) */
  detect(cwd?: string): ProjectSample {
    return { project: this.project(cwd), branch: this.branch(cwd) }
  }

  /* 定位采样目录所属的 Git 仓库;非 Git 目录返回 null */
  private locate(cwd: string): GitLocation | null {
    const cached = this.locations.get(cwd)
    if (cached !== undefined) return cached
    const location = resolveGitLocation(cwd)
    this.locations.set(cwd, location)
    return location
  }
}

/* 从采样目录逐级向上查找 Git 标记,命中且头文件可解析时返回定位结果 */
function resolveGitLocation(cwd: string): GitLocation | null {
  let dir = resolve(cwd)
  for (let depth = 0; depth < GIT_ROOT_MAX_DEPTH; depth++) {
    const marker = join(dir, GIT_DIR_NAME)
    if (existsSync(marker)) {
      const gitDir = resolveGitDir(marker)
      const headPath = gitDir === null ? null : resolveHeadPath(gitDir)
      /* 标记存在但头文件不可解析:继续向上,交给父级仓库 */
      if (headPath !== null) return { root: dir, headPath }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/* .git 为目录时直接使用;为文件时读取 gitdir 指向路径(相对路径相对该文件所在目录) */
function resolveGitDir(marker: string): string | null {
  try {
    if (statSync(marker).isDirectory()) return marker
    const text = readFileSync(marker, 'utf-8')
    const matched = /^gitdir:[ \t]*(.+)$/m.exec(text)
    const target = matched?.[1].trim()
    if (!target) return null
    return isAbsolute(target) ? target : resolve(dirname(marker), target)
  } catch {
    return null
  }
}

/* 头文件:优先 Git 目录自身的 HEAD,否则经 commondir 指向主仓库的 HEAD(worktree) */
function resolveHeadPath(gitDir: string): string | null {
  try {
    const own = join(gitDir, 'HEAD')
    if (existsSync(own)) return own
    const commonDirFile = join(gitDir, 'commondir')
    if (!existsSync(commonDirFile)) return null
    const target = readFileSync(commonDirFile, 'utf-8').trim()
    if (!target) return null
    const commonDir = isAbsolute(target) ? target : resolve(gitDir, target)
    const head = join(commonDir, 'HEAD')
    return existsSync(head) ? head : null
  } catch {
    return null
  }
}

/* 解析头文件内容:`ref: refs/heads/<分支>`;detached HEAD 与异常内容返回 undefined */
function readBranch(headPath: string): string | undefined {
  try {
    const head = readFileSync(headPath, 'utf-8').trim()
    const matched = /^ref: refs\/heads\/(.+)$/.exec(head)
    return matched ? matched[1] : undefined
  } catch {
    return undefined
  }
}
