/*
 * WakaTime 插件浏览器端
 * 作者: JularDepick
 *
 * 在「设置-插件」页面的标签槽注册 wakatime 标签页:数据面板与配置区
 * 一体,数据经 host 的 /api/wakatime/* 接口读写(仅 web profile 提供)。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only:拉取 ui-settings 的 SlotMap 合并(settings.plugins.tab 声明)。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { WakatimeTab } from './WakatimeTab.tsx'

export { WakatimeTab }

/** 必需服务:slot 注册表 */
export const inject = ['slots']

/**
 * 浏览器端插件主体:等待 settings.plugins.tab 声明后注册 wakatime 标签页。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'wakatime',
    order: 20,
    label: () => 'WakaTime',
  }, WakatimeTab))
}
