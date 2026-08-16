/*
 * dsh-wakatime-plugin 插件入口
 * 作者: JularDepick
 *
 * 将 DSH 的 AI 交互量化并上报至 WakaTime(心跳、Token 统计、会话追踪、OAuth 2.0)。
 * 初始化阶段:仅装配模块骨架,功能接入点(事件监听、工具注册、OAuth 流程)
 * 以注释标明,留待后续会话按 AGENTS.md 指示实现。
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config'
import type { Config as ConfigType } from './config'
import { DEFAULT_LANGUAGE, ENV_DEBUG } from './constants'
import { setLanguage } from './translation'
import { OAuthModule } from './oauth'
import { HeartbeatEngineImpl } from './heartbeat'
import { ConfigManagerImpl } from './config-manager'

export const name = 'wakatime'

/* 工具/事件依赖在功能实现阶段按需加入,骨架阶段无需必需服务 */

export { Config }

export function apply(ctx: Context, config: ConfigType) {
  /* 按配置初始化界面语言(回退默认语言) */
  setLanguage(config.locale || DEFAULT_LANGUAGE)

  /* 装配业务模块:当前为占位实现,方法调用会抛出"尚未实现"错误 */
  const oauth = new OAuthModule()
  const heartbeat = new HeartbeatEngineImpl()
  const configManager = new ConfigManagerImpl()

  const debug = config.debug || process.env[ENV_DEBUG] === '1'
  if (debug) {
    ctx.logger?.info?.('[wakatime] modules assembled (skeleton)')
  }

  /*
   * 功能接入点(后续会话实现):
   * 1. OAuth 流程:buildAuthorizeUrl -> waitForCallback -> exchangeCode,
   *    令牌经 ConfigManagerImpl 持久化,过期前自动 refresh。
   * 2. 事件监听:ctx.on('agent/step' | 'tools/result' | 'session/event', ...)
   *    采集 Token 用量与工具调用,经 HeartbeatEngineImpl 上报。
   * 3. 工具注册:ctx.tools.register(defineTool(...)) 暴露战绩查询工具,
   *    届时需声明 inject: ['tools']。
   */

  void oauth
  void heartbeat
  void configManager
}