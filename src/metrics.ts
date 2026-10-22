/*
 * 量化指标口径与格式化(host 工具与浏览器端共用)
 * 作者: JularDepick
 *
 * 同一份数据在工具面与 Web 战绩表两侧必须同名同口径,故把可复用的纯函数集中在此:
 * 思考时长格式化(hh:MM:ss)、平均输出速度(输出 TOKEN ÷ 思考秒数向下取整)、
 * 有效 TOKEN 消耗量(输入+输出)。本文件无任何依赖,host 与 client 产物均可引用。
 */

/* 时长格式:hh:MM:ss(小时不足两位补前导零,超过两位不再补零且不设上限;分与秒各两位) */
export function formatThinkingDuration(millis: number): string {
  const totalSeconds = Math.floor(Math.max(millis, 0) / 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${pad(hours)}:${pad(minutes)}:${pad(totalSeconds % 60)}`
}

/* 数位分隔:每 groupSize 位一组插入英文逗号(千位=3,万位=4);
   非有限值按 0 处理,负号只留在最前(战绩数值恒为非负,负值仅为兜底) */
export function groupDigits(value: number, groupSize: number): string {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0
  const digits = Math.abs(safe).toString()
  const size = Math.max(1, Math.trunc(groupSize))
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= size) {
    groups.unshift(digits.slice(Math.max(0, end - size), end))
  }
  return `${safe < 0 ? '-' : ''}${groups.join(',')}`
}

/* 平均输出速度:输出 TOKEN 总量 ÷ 思考总时长(秒)后向下取整,单位 token/s;
   思考时长为 0(或为负的异常值)时记 0,避免除零与无穷值 */
export function averageOutputSpeed(outputTokens: number, thinkingMs: number): number {
  if (thinkingMs <= 0) return 0
  return Math.floor(outputTokens / (thinkingMs / 1000))
}

/* API 有效 TOKEN 消耗:输入 + 输出(官方 Heartbeat 仅 ai_input_tokens/ai_output_tokens,
   缓存命中 Token 无官方字段,不并入) */
export function effectiveTokens(stats: { inputTokens: number; outputTokens: number }): number {
  return stats.inputTokens + stats.outputTokens
}
