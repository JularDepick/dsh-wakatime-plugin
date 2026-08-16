/*
 * tsdown 打包配置
 * 作者: JularDepick
 *
 * 产物为 ESM(.mjs + .d.mts),与 package.json 的 main/types 对齐;
 * 翻译 ini 随产物复制到 dist/ 根(翻译加载器经 import.meta.url 同目录定位)。
 */

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: false,
  copy: ['src/translation/zh-CN.ini', 'src/translation/en-US.ini'],
})