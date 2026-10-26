/*
 * 配置管理模块类型定义
 * 作者: JularDepick
 *
 * 管理本地凭证与插件配置的读写,路径见 constants.ts。
 * API Key 与 OAuth 访问令牌同为敏感凭证,只允许覆盖写入,任何读取面均不回显明文。
 */

/* 一条已保存的凭证(明文只在本文件与 host 进程内出现, 任何接口只下发 maskedSecret) */
export interface StoredCredentialRecord {
  /* 凭证标识(凭证原文摘要前 16 位, 与数据桶标识同源) */
  id: string
  /* 凭证类型:插件密钥 / OAuth 访问令牌(由前缀识别, 同权使用) */
  type: 'api_key' | 'oauth'
  /* 凭证原文(仅本地保存, 不回显) */
  secret: string
  /* 展示用打码凭证 */
  maskedSecret: string
  /* 验证成功时缓存的用户 id 与账号名 */
  userId?: string
  username?: string
  /* 加入与最近使用时刻(Unix 毫秒) */
  addedAt: number
  lastUsedAt: number
}

/* 本地持久化配置(含凭证,存于用户目录,权限收紧由实现负责) */
export interface StoredConfig {
  /* 已保存的凭证列表(多凭证缓存, 可切换) */
  credentials?: StoredCredentialRecord[]
  /* 当前激活凭证的标识(缺省回退到列表最后一项) */
  activeCredentialId?: string
  /* settings 最后一次变更时刻(Unix 毫秒):多进程合并时按它取较新的一侧 */
  settingsUpdatedAt?: number
  /* 激活项最后一次变更时刻(Unix 毫秒):多进程合并时用于判定两侧谁更新 */
  activeUpdatedAt?: number
  /* 凭证删除墓碑:凭证标识 -> 删除时刻;合并时墓碑不早于加入时刻的凭证不再复活 */
  credentialTombstones?: Record<string, number>
  /* 旧版单字段凭证:仅用于首次启动迁移为凭证列表, 迁移后置空 */
  apiKey?: string
  oauthToken?: string
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
    /* 战绩表边框开关(Web 配置页可改,纯展示项);旧配置文件无此字段时按 schema 默认值处理 */
    tableBorders?: boolean
    /* 战绩显示策略:all 全部密钥战绩 / current 当前密钥战绩 */
    statsScope?: 'all' | 'current'
    /* 数位分隔符:thousand 千位一组 / myriad 万位一组(纯展示项) */
    digitGrouping?: 'thousand' | 'myriad'
    /* Web 设置页可编辑项(经 /api/wakatime/config 写入,重启后合并恢复) */
    locale?: string
  }
}

/* 配置管理器对外能力 */
export interface ConfigManager {
  /* 读取配置,不存在时返回 null */
  load(): Promise<StoredConfig | null>
  /* 写入配置:持锁读盘 -> 与磁盘内容合并 -> 原子写入;返回合并后的最终配置 */
  save(config: StoredConfig): Promise<StoredConfig>
  /* 检测其它进程是否改过文件(mtime 变化), 有变化时返回合并后的配置, 否则返回 null */
  refresh(): Promise<StoredConfig | null>
}
