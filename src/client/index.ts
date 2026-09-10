/*
 * WakaTime 插件浏览器端
 * 作者: JularDepick
 *
 * 在会话区域的视图标签栏(对话/轨迹所在)注册 wakatime 标签页:
 * Agent 协作战绩、API Key 覆盖管理(小后端代理)与配置区。
 * 语言跟随 dsh web UI 语言切换(zh/en 字典)。
 * 注册模式与官方 ui-trajectory 相同。
 * (0.1.5 起 dsh-client-runtime 拆分,client 上下文即 cordis Context,
 * slots 声明来自 dsh-client-ui-renderer)
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only:拉取 ui-conversation 的 SlotMap 合并(conversation.view 声明)。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only:拉取 ui-renderer 的 Context 合并(ctx.slots = SlotRegistry)。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only:拉取 locale 插件的 Context 合并(ctx.locale)。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WakatimeTab } from './WakatimeTab.tsx'
import { en, zh, type WakatimeKey } from './locales.ts'

export { WakatimeTab }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** WakaTime 标签页文案 */
    wakatime: WakatimeKey
  }
}

/** 字典命名空间 */
const NS = 'wakatime'

/** 必需服务:slot 注册表与 locale 服务 */
export const inject = ['slots', 'locale']

/**
 * 浏览器端插件主体:注册字典并等待 conversation.view 声明后注册标签页。
 * @param ctx - 浏览器插件上下文(cordis Context,slots/locale 经声明合并)。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wakatime: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'wakatime',
    order: 20,
    locale: NS,
    label: () => t('tab.label'),
  }, WakatimeTab))
}
