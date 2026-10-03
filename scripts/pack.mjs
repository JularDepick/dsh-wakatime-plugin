/*
 * 打包入口脚本
 * 作者: JularDepick
 *
 * 用途:把打包产物统一收拢到工作区内的 release/,避免 tarball 散落在工作区根目录。
 * 默认流程:执行 pnpm pack --pack-destination release(pnpm pack 会触发 prepare 再次构建),
 * 随后把工作区根目录残留的本包 tarball 一并迁入产物目录。
 * 以 --move-only 调用时只做迁移,供 package.json 的 postpack 生命周期挂钩使用,
 * 这样即使直接执行 pnpm pack(不带 --pack-destination)也能自动收拢产物;
 * 该模式下不调用打包命令,不会与 pack 脚本互相递归。
 * 可用环境变量 WAKATIME_PACK_DEST 覆盖产物目录。
 * 子进程 stdio 走 inherit(受限环境下 pipe-spawn 会被拒绝)。
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const cwd = process.cwd()
const destDir = resolve(cwd, process.env.WAKATIME_PACK_DEST ?? 'release')
/* 只迁移本包产物,避免误动同目录下的其它 tarball */
const TARBALL_PATTERN = /^dsh-wakatime-plugin-\d+\.\d+\.\d+.*\.tgz$/

/* 把工作区根目录下的本包 tarball 迁入产物目录(同名覆盖) */
function migrate() {
  let names
  try {
    names = readdirSync(cwd)
  } catch {
    return
  }
  for (const name of names) {
    if (!TARBALL_PATTERN.test(name)) continue
    const from = join(cwd, name)
    try {
      if (!statSync(from).isFile()) continue
    } catch {
      continue
    }
    const to = join(destDir, name)
    mkdirSync(destDir, { recursive: true })
    rmSync(to, { force: true })
    renameSync(from, to)
    console.log(`[pack] 产物已收拢到 ${to}`)
  }
}

if (process.argv.includes('--move-only')) {
  migrate()
} else {
  mkdirSync(destDir, { recursive: true })
  /* 先收拢根目录残留产物,避免它们被打进本次 tarball(files 白名单之外的场景) */
  migrate()
  /* 以整条命令字符串配合 shell 执行,避免 Node 对 args + shell 组合的弃用告警;
     产物目录加引号,兼容含空格的工作区路径 */
  const child = spawn(`pnpm pack --pack-destination "${destDir}"`, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })

  child.on('exit', (code, signal) => {
    if (signal !== null) {
      console.error(`[pack] pnpm pack 被信号终止: ${signal}`)
      process.exit(1)
    }
    if ((code ?? 1) !== 0) {
      console.error(`[pack] pnpm pack 失败,退出码 ${code}`)
      process.exit(code ?? 1)
    }
    /* 迁移兜底:打包链未落到产物目录时,把根目录产物补收 */
    migrate()
    process.exit(0)
  })

  child.on('error', (error) => {
    console.error(`[pack] 无法启动 pnpm pack: ${error.message}`)
    process.exit(1)
  })
}
