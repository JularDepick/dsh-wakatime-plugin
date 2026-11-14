/*
 * 翻译加载器
 * 作者: JularDepick
 *
 * 按 locale 加载 src/translation/ 下对应的 xx-YY.ini,解析 [translation] 节键值;
 * 未命中翻译时回退默认语言(zh-CN),文件缺失时回退空表由主逻辑兜底。
 */

import { readFileSync } from 'node:fs'
import { DEFAULT_LANGUAGE, FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '../constants'

/* 当前激活的语言 */
let currentLanguage = DEFAULT_LANGUAGE

/* 语言缓存:避免重复读盘 */
const cache = new Map<string, Record<string, string>>()

/* 解析 INI 文本,仅提取 [translation] 节的键值对 */
function parseTranslationSection(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  let inTranslation = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      /* 进入 [translation] 节前暂不收集 */
      inTranslation = line === '[translation]'
      continue
    }
    if (!inTranslation) continue
    const equalIndex = line.indexOf('=')
    if (equalIndex <= 0) continue
    const key = line.slice(0, equalIndex).trim()
    const value = line.slice(equalIndex + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/* 定位并加载指定语言的翻译表,文件缺失或解析失败时返回空表 */
function loadTable(locale: string): Record<string, string> {
  const cached = cache.get(locale)
  if (cached) return cached
  let table: Record<string, string> = {}
  try {
    /* 与当前模块同目录查找 xx-YY.ini(构建时由打包配置复制到产物同目录) */
    const url = new URL(`./${locale}.ini`, import.meta.url)
    table = parseTranslationSection(readFileSync(url, 'utf-8'))
  } catch {
    /* 读盘失败不写缓存: 否则一次暂时缺文件会让该语言在进程内永久回退成空表 */
    return table
  }
  cache.set(locale, table)
  return table
}

/* 查询翻译:先查当前语言,未命中回退默认语言,仍缺失则返回键名本身 */
export function translate(key: string, locale: string = currentLanguage): string {
  const direct = loadTable(locale)[key]
  if (direct !== undefined) return direct
  if (locale !== FALLBACK_LANGUAGE) {
    const fallback = loadTable(FALLBACK_LANGUAGE)[key]
    if (fallback !== undefined) return fallback
  }
  return key
}

/* 语言切换入口,返回切换后的语言.
   白名单校验放在加载器自身: locale 会被拼进 ini 文件名, 上游三处(配置 schema, 运行期配置, 持久化合并)
   都已校验, 但任何新增调用点漏校验就会读不到文件(静默回退中文)甚至越出产物目录 */
export function setLanguage(locale: string): string {
  const allowed = (SUPPORTED_LANGUAGES as readonly string[]).includes(locale)
  currentLanguage = allowed ? locale : DEFAULT_LANGUAGE
  return currentLanguage
}

/* 获取当前语言 */
export function getLanguage(): string {
  return currentLanguage
}