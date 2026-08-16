/*
 * 配置管理模块类型定义
 * 作者: JularDepick
 *
 * 管理本地凭证与插件配置的读写,路径见 constants.ts。
 */

/* 本地持久化配置(含凭证,存于用户目录,权限收紧由实现负责) */
export interface StoredConfig {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  clientId?: string
  userId?: string
  username?: string
  settings: {
    enabled: boolean
    heartbeatInterval: number
    projectDetection: string
    includeTokens: boolean
    includePrompts: boolean
    debug: boolean
    /* Web 设置页可编辑项(经 /api/wakatime/config 写入,重启后合并恢复) */
    locale?: string
    clientId?: string
    callbackPort?: number
  }
}

/* 配置管理器对外能力:初始化骨架阶段仅声明签名,实现待后续会话填充 */
export interface ConfigManager {
  /* 读取配置,不存在时返回 null */
  load(): Promise<StoredConfig | null>
  /* 写入配置 */
  save(config: StoredConfig): Promise<void>
  /* 删除配置(登出时使用) */
  clear(): Promise<void>
}