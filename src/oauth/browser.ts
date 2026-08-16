/*
 * 浏览器打开助手
 * 作者: JularDepick
 *
 * 按平台打开系统默认浏览器;失败返回 false 由调用方兜底展示授权地址。
 */

import { spawn } from 'node:child_process'

export function openBrowser(url: string): boolean {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    }
    return true
  } catch {
    return false
  }
}