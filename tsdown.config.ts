/*
 * tsdown 打包配置(host 面 + client 面)
 * 作者: JularDepick
 *
 * host 面:ESM(.mjs + .d.mts),与 package.json 的 main/types 对齐,
 * 翻译 ini 随产物复制到 dist/ 根。
 * client 面:浏览器 bundle(dist/client.js),格式为
 * window.__ModuleLoader__.load({ id, factory }) 的 CJS 包装,
 * 平台模块 external、其余内联,CSS Modules 经 lightningcss 内联注入。
 * 产物格式细节与机制说明见 .agent/web-tab-experience.md。
 */

import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/* 浏览器平台模块:宿主冻结模块表中的 seed 词,client 产物以此为 external */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/* runtime store 引擎的官方外部豁免 */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/* CSS Modules 虚拟 id 包装:后缀不能是 .css,否则被 tsdown 自带 css 管线接管 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/* 跨插件 value 导入门:仅放行平台模块,其余 @deepseek-ai 一律构建错误 */
const purityPlugin = {
  name: 'dsh-client-bundle-purity',
  resolveId(source: string) {
    if (!source.startsWith('@deepseek-ai/')) return null
    if (CLIENT_EXTERNALS.includes(source)) return null
    throw new Error(
      `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) — `
      + 'cross-plugin value imports are forbidden; use type-only imports and cordis services',
    )
  },
}

/* CSS Modules 内联插件:lightningcss 编译 + 注入 <style data-plugin> */
function cssModulesPlugin(pluginId: string) {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(this: { addWatchFile: (id: string) => void }, virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      const tagId = `${pluginId}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

const NODE_ENV = process.env.NODE_ENV ?? 'production'

export default defineConfig([
  /* host 面(节点端) */
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: true,
    clean: true,
    sourcemap: false,
    copy: ['src/translation/zh-CN.ini', 'src/translation/en-US.ini'],
  },
  /* client 面(浏览器端) */
  {
    name: 'dsh-wakatime-plugin/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'dist',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
      'import.meta.env.MODE': JSON.stringify(NODE_ENV),
      'import.meta.env': JSON.stringify({ MODE: NODE_ENV }),
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityPlugin, cssModulesPlugin('dsh-wakatime-plugin')],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-wakatime-plugin", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
