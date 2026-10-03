/*
 * 战绩累计量持久化
 * 作者: JularDepick
 *
 * 本地独有指标(LLM 思考时长、提示词 Token 估算)在官方 Heartbeat 字段表中没有
 * 对应项,无法从云端恢复;为让这类指标跨进程重启继续累加,把累计量快照落盘于
 * 凭证目录(与配置文件同目录、同权限收紧),启动时读回并交给 StatsTracker.seed()。
 * 写入防抖(STATS_SAVE_DEBOUNCE_MS),初始读取完成前忽略写入,避免用空值覆盖历史;
 * 卸载时立即落盘最后一次累计量。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STATS_FILE_NAME, STATS_SAVE_DEBOUNCE_MS } from '../constants'
import { hardenPathPermissions, resolveConfigDir } from '../config-manager'
import { normalizeTotals } from '../stats'
import type { StatsTotals } from '../stats'

export class StatsStore {
  /* 初始读取完成前不写入,避免启动瞬间用空累计量覆盖历史快照 */
  private ready = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: StatsTotals | undefined

  /* 读取快照:不存在或损坏时返回 undefined(视为无历史累计) */
  async load(): Promise<StatsTotals | undefined> {
    try {
      const text = await readFile(this.path(), 'utf-8')
      const parsed: unknown = JSON.parse(text)
      this.ready = true
      return normalizeTotals(parsed)
    } catch {
      this.ready = true
      return undefined
    }
  }

  /* 记录最新累计量:防抖落盘;初始读取完成前忽略 */
  save(totals: StatsTotals): void {
    if (!this.ready) return
    this.pending = totals
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => { void this.flush() }, STATS_SAVE_DEBOUNCE_MS)
    /* 不因等待写盘而拖住宿主进程退出 */
    this.timer.unref?.()
  }

  /* 立即落盘(卸载时调用);失败静默,不影响插件运行 */
  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const totals = this.pending
    this.pending = undefined
    if (totals === undefined) return
    const dir = resolveConfigDir()
    const path = this.path()
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(path, JSON.stringify(totals, null, 2), { mode: 0o600 })
      await hardenPathPermissions(dir, path)
    } catch {
      /* 尽力而为:落盘失败不影响统计与上报 */
    }
  }

  private path(): string {
    return join(resolveConfigDir(), STATS_FILE_NAME)
  }
}
