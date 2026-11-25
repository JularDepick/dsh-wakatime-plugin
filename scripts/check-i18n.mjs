/*
 * i18n 键集一致性校验
 * 作者: JularDepick
 *
 * 校验四件事, 任一不通过即以非零码退出:
 * 1. 三份 ini(zh-CN / en-US / .example_zh-CN)的 [translation] 键集与取值;
 * 2. .example_zh-CN.ini 与 zh-CN.ini 逐字节一致;
 * 3. 浏览器字典 src/client/locales.ts 的 zh / en 键集与 WakatimeKey 联合完全一致;
 * 4. host 侧 translate('...') 用到的字面键都存在于 ini.
 */

import { readFileSync } from 'node:fs'

const problems = []

function parseIni(text, file) {
  const entries = new Map()
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue
    const head = line.match(/^\[([^\]]+)\]$/)
    if (head) { section = head[1]; continue }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    if (section !== 'translation') continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (entries.has(key)) problems.push(file + ': duplicate key ' + key)
    if (value === '') problems.push(file + ': empty value for ' + key)
    entries.set(key, value)
  }
  return entries
}

function diffKeys(a, b, labelA, labelB) {
  const left = a instanceof Map ? a.keys() : a
  const right = b instanceof Map ? b.keys() : b
  for (const key of left) if (!(b instanceof Map ? b.has(key) : b.has(key))) problems.push(labelA + ' has ' + key + ', ' + labelB + ' does not')
  for (const key of right) if (!(a instanceof Map ? a.has(key) : a.has(key))) problems.push(labelB + ' has ' + key + ', ' + labelA + ' does not')
}

function blockKeys(text, startMarker) {
  const start = text.indexOf(startMarker)
  if (start < 0) return new Set()
  const rest = text.slice(start + startMarker.length)
  const end = rest.indexOf('\n}')
  const body = end < 0 ? rest : rest.slice(0, end)
  const keys = new Set()
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*'([^']+)'\s*:/)
    if (m) keys.add(m[1])
  }
  return keys
}

const zhText = readFileSync('src/translation/zh-CN.ini', 'utf8')
const enText = readFileSync('src/translation/en-US.ini', 'utf8')
const exampleText = readFileSync('src/translation/.example_zh-CN.ini', 'utf8')
const zh = parseIni(zhText, 'zh-CN.ini')
const en = parseIni(enText, 'en-US.ini')
const example = parseIni(exampleText, '.example_zh-CN.ini')

diffKeys(zh, en, 'zh-CN.ini', 'en-US.ini')
diffKeys(zh, example, 'zh-CN.ini', '.example_zh-CN.ini')
if (zhText !== exampleText) problems.push('.example_zh-CN.ini differs from zh-CN.ini')

const locales = readFileSync('src/client/locales.ts', 'utf8')
const dictZh = blockKeys(locales, 'export const zh: WakatimeDict = {')
const dictEn = blockKeys(locales, 'export const en: WakatimeDict = {')
const typeBlock = locales.slice(locales.indexOf('export type WakatimeKey ='), locales.indexOf('export const zh'))
const declared = new Set([...typeBlock.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1]))
diffKeys(dictZh, dictEn, 'locales.zh', 'locales.en')
diffKeys(declared, dictZh, 'WakatimeKey', 'locales.zh')

const hostFiles = ['src/tools/index.ts']
for (const file of hostFiles) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/translate\('([^']+)'\)/g)) {
    if (!zh.has(m[1])) problems.push(file + ': translate key ' + m[1] + ' missing from zh-CN.ini')
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('[i18n] ' + problem)
  console.error('[i18n] ' + problems.length + ' problem(s) found')
  process.exitCode = 1
} else {
  console.log('[i18n] ok: ' + zh.size + ' host keys, ' + dictZh.size + ' client keys')
}
