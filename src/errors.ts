/*
 * 占位错误定义
 * 作者: JularDepick
 *
 * 初始化阶段业务模块尚未实现,占位方法统一抛出本错误,便于识别遗留位置。
 */

export class NotImplementedError extends Error {
  constructor(scope: string) {
    super(`尚未实现: ${scope}`)
    this.name = 'NotImplementedError'
  }
}