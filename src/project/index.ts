/*
 * 项目与分支检测
 * 作者: JularDepick
 *
 * projectDetection 当前策略为 auto:项目名取工作目录 basename,
 * 分支名解析 .git/HEAD。
 */

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export class ProjectDetector {
  private readonly cwd: string

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd
  }

  /* 项目名:工作目录 basename */
  project(): string {
    return basename(this.cwd) || 'unknown'
  }

  /* 当前 Git 分支;非 Git 目录或 detached HEAD 返回 undefined */
  branch(): string | undefined {
    try {
      const head = readFileSync(join(this.cwd, '.git', 'HEAD'), 'utf-8').trim()
      const matched = /^ref: refs\/heads\/(.+)$/.exec(head)
      return matched ? matched[1] : undefined
    } catch {
      return undefined
    }
  }
}