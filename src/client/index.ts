/*
 * WakaTime 插件浏览器端
 * 作者: JularDepick
 *
 * 在会话区域的视图标签栏(对话/轨迹所在)注册 wakatime 标签页:
 * 全局统计面板与配置区一体,数据经 host 的 /api/wakatime/* 接口读写
 * (仅 web profile 提供)。注册模式与官方 ui-trajectory 相同。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only:拉取 ui-conversation 的 SlotMap 合并(conversation.view 声明)。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { WakatimeTab } from './WakatimeTab.tsx'

export { WakatimeTab }

/** 必需服务:slot 注册表 */
export const inject = ['slots']

/**
 * 浏览器端插件主体:等待 conversation.view 声明后注册 wakatime 标签页。
 * 标签页为全局统计(数据来自 host 全局聚合接口),不依赖会话座位。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'wakatime',
    order: 20,
    label: () => 'WakaTime',
  }, WakatimeTab))
}
