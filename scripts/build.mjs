/*
 * 构建入口脚本
 * 作者: JularDepick
 *
 * 用途:把构建链的临时目录固定到工作目录内的 temp/,再执行 tsdown。
 * 背景:声明生成插件(rolldown-plugin-dts)经 Node 的 os.tmpdir() 取临时目录,
 * 默认写系统 %TEMP%(工作目录之外);受限环境下会被拒绝,报 TS5033 导致 dts 阶段
 * 失败(现象具欺骗性:日志前半段已显示 client 面构建成功)。
 * 可用环境变量 WAKATIME_BUILD_TMP 指定其它目录覆盖默认值。
 * 不用管道捕获子进程输出(受限环境下 pipe-spawn 会被拒绝),故 stdio 走 inherit。
 */

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const cwd = process.cwd()
const tmp = process.env.WAKATIME_BUILD_TMP ?? join(cwd, 'temp')
mkdirSync(tmp, { recursive: true })

const child = spawn('tsdown', process.argv.slice(2), {
  cwd,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    TEMP: tmp,
    TMP: tmp,
    /* 供需要绝对路径的工具使用 */
    WAKATIME_BUILD_TMP: isAbsolute(tmp) ? tmp : join(cwd, tmp),
  },
})

child.on('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`[build] tsdown 被信号终止: ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(`[build] 无法启动 tsdown: ${error.message}`)
  process.exit(1)
})
