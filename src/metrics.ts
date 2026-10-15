/*
 * 量化指标口径与格式化(host 工具与浏览器端共用)
 * 作者: JularDepick
 *
 * 同一份数据在工具面与 Web 战绩表两侧必须同名同口径,故把可复用的纯函数集中在此:
 * 思考时长格式化(hh:MM:ss)、平均输出速度(输出 TOKEN ÷ 思考秒数向下取整)、
 * 有效 TOKEN 消耗量(输入+输出)。本文件无任何依赖,host 与 client 产物均可引用。
 */

/* 时长格式:hh:MM:ss(小时无前导零且不设上限,分与秒各两位) */
export function formatThinkingDuration(millis: number): string {
  const totalSeconds = Math.floor(Math.max(millis, 0) / 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}:${pad(minutes)}:${pad(totalSeconds % 60)}`
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
