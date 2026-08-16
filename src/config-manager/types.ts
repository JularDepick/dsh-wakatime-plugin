/*
 * 配置管理模块类型定义
 * 作者: JularDepick
 *
 * 管理本地凭证与插件配置的读写,路径见 constants.ts。
 * API Key 为敏感凭证,只允许覆盖写入,任何读取面均不回显明文。
 */

/* 本地持久化配置(含凭证,存于用户目录,权限收紧由实现负责) */
export interface StoredConfig {
  /* WakaTime API Key(仅覆盖写入,不提供查看) */
  apiKey?: string
  /* 最近一次验证成功时的用户资料(缓存,仅展示用) */
  userId?: string
  username?: string
  settings: {
    enabled: boolean
    reportInterval: number
    reportEnabled: boolean
    includeTokens: boolean
    includePrompts: boolean
    debug: boolean
    /* Web 设置页可编辑项(经 /api/wakatime/config 写入,重启后合并恢复) */
    locale?: string
  }
}

/* 配置管理器对外能力 */
export interface ConfigManager {
  /* 读取配置,不存在时返回 null */
  load(): Promise<StoredConfig | null>
  /* 写入配置 */
  save(config: StoredConfig): Promise<void>
  /* 删除配置(清除凭证时使用) */
  clear(): Promise<void>
}
