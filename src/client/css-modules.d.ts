/*
 * CSS Modules 类型声明
 * 作者: JularDepick
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
