/*
 * i18n 键集一致性校验
 * 作者: JularDepick
 *
 * 任一检查不通过即以非零码退出:
 * 1. 三份 ini 的 [translation] 键集一致, 无重复键/空值;
 * 2. .example_zh-CN.ini 与 zh-CN.ini 逐字节一致;
 * 3. [meta] 的 for 等于 package.json 版本, lang 与文件名匹配, endtime 形如 yyyy-MM-dd HH:mm:ss+HH:mm;
 * 4. 中英值的 {占位符} 集合一致;
 * 5. 浏览器字典 zh/en 与 WakatimeKey 联合三方一致;
 * 6. 遍历 src 下所有 .ts 里的 translate('...'), 与 ini 做双向差集(缺失与死键都要报).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const problems = []

function parseIni(text, file, section) {
  const entries = new Map()
  const meta = new Map()
  let current = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue
    const head = line.match(/^\[([^\]]+)\]$/)
    if (head) { current = head[1]; continue }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (current === 'meta') {
      if (meta.has(key)) problems.push(file + ': duplicate meta key ' + key)
      meta.set(key, value)
      continue
    }
    if (current !== section) continue
    if (entries.has(key)) problems.push(file + ': duplicate key ' + key)
    if (value === '') problems.push(file + ': empty value for ' + key)
    entries.set(key, value)
  }
  return { entries, meta }
}

function diffKeys(a, b, labelA, labelB) {
  const left = a instanceof Map ? a.keys() : a
  const right = b instanceof Map ? b.keys() : b
  for (const key of left) if (!b.has(key)) problems.push(labelA + ' has ' + key + ', ' + labelB + ' does not')
  for (const key of right) if (!a.has(key)) problems.push(labelB + ' has ' + key + ', ' + labelA + ' does not')
}

function blockKeys(text, startMarker, label) {
  const start = text.indexOf(startMarker)
  if (start < 0) return new Map()
  const rest = text.slice(start + startMarker.length)
  const end = rest.indexOf('\n}')
  const body = end < 0 ? rest : rest.slice(0, end)
  const entries = new Map()
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*'([^']+)'\s*:\s*(.*)$/)
    if (!m) continue
    if (entries.has(m[1])) problems.push(label + ': duplicate key ' + m[1])
    entries.set(m[1], m[2])
  }
  return entries
}

function placeholders(value) {
  return new Set([...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name)
    if (name.isDirectory()) walk(path, out)
    else if (name.name.endsWith('.ts') || name.name.endsWith('.tsx')) out.push(path.replace(/\\/g, '/'))
  }
  return out
}

const zhText = readFileSync('src/translation/zh-CN.ini', 'utf8')
const enText = readFileSync('src/translation/en-US.ini', 'utf8')
const exampleText = readFileSync('src/translation/.example_zh-CN.ini', 'utf8')
const zh = parseIni(zhText, 'zh-CN.ini', 'translation')
const en = parseIni(enText, 'en-US.ini', 'translation')
const example = parseIni(exampleText, '.example_zh-CN.ini', 'translation')

diffKeys(zh.entries, en.entries, 'zh-CN.ini', 'en-US.ini')
diffKeys(zh.entries, example.entries, 'zh-CN.ini', '.example_zh-CN.ini')
if (zhText !== exampleText) problems.push('.example_zh-CN.ini differs from zh-CN.ini')

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
for (const [file, parsed, lang] of [['zh-CN.ini', zh, 'zh-CN'], ['en-US.ini', en, 'en-US'], ['.example_zh-CN.ini', example, 'zh-CN']]) {
  if (parsed.meta.get('for') !== 'v' + version) problems.push(file + ': for=' + (parsed.meta.get('for') ?? '<missing>') + ', expected v' + version)
  if (parsed.meta.get('lang') !== lang) problems.push(file + ': lang=' + (parsed.meta.get('lang') ?? '<missing>') + ', expected ' + lang)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/.test(parsed.meta.get('endtime') ?? '')) {
    problems.push(file + ': endtime is not yyyy-MM-dd HH:mm:ss+HH:mm')
  }
}

for (const [key, value] of zh.entries) {
  const other = en.entries.get(key)
  if (other === undefined) continue
  const a = placeholders(value)
  const b = placeholders(other)
  diffKeys(a, b, 'zh ' + key, 'en ' + key)
}

const locales = readFileSync('src/client/locales.ts', 'utf8')
const dictZh = blockKeys(locales, 'export const zh: WakatimeDict = {', 'locales.zh')
const dictEn = blockKeys(locales, 'export const en: WakatimeDict = {', 'locales.en')
const typeBlock = locales.slice(locales.indexOf('export type WakatimeKey ='), locales.indexOf('export const zh'))
const declared = new Set([...typeBlock.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1]))
diffKeys(dictZh, dictEn, 'locales.zh', 'locales.en')
diffKeys(declared, dictZh, 'WakatimeKey', 'locales.zh')
/* 客户端占位符也要中英一致: 只比键集会漏掉 {name} 被写成 {user} 这类 */
for (const [key, raw] of dictZh) {
  const other = dictEn.get(key)
  if (other === undefined) continue
  diffKeys(placeholders(raw), placeholders(other), 'locales.zh ' + key, 'locales.en ' + key)
}

const used = new Set()
const clientUsed = new Set()
for (const file of walk('src')) {
  if (file.startsWith('src/translation/')) continue
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/translate\(\s*['"]([^'"]+)['"]\s*\)/g)) used.add(m[1])
  if (file.startsWith('src/client/')) {
    for (const m of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g)) clientUsed.add(m[1])
  }
}
for (const key of clientUsed) if (!declared.has(key)) problems.push('client t() key missing from WakatimeKey: ' + key)
for (const key of used) if (!zh.entries.has(key)) problems.push('translate key missing from zh-CN.ini: ' + key)
for (const key of zh.entries.keys()) if (!used.has(key)) problems.push('unused host key in zh-CN.ini: ' + key)

if (problems.length > 0) {
  for (const problem of problems) console.error('[i18n] ' + problem)
  console.error('[i18n] ' + problems.length + ' problem(s) found')
  process.exitCode = 1
} else {
  console.log('[i18n] ok: ' + zh.entries.size + ' host keys, ' + dictZh.size + ' client keys')
}
