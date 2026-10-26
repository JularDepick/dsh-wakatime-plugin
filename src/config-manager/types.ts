/*
 * 配置管理模块类型定义
 * 作者: JularDepick
 *
 * 本地只保存一份 OAuth 凭证(0.4.0 起): 更换凭证直接覆盖,
 * 本地数据与该凭证无关, 故不随凭证变化. 明文只在本文件与 host 进程内出现.
 */

import { CONFIG_FILE_VERSION } from '../constants'

/* 已保存的凭证(明文不回显) */
export interface StoredCredential {
  /* 凭证原文(仅本地保存) */
  secret: string
  /* 凭证类型: 0.4.0 起只有 OAuth 访问令牌 */
  type: 'oauth'
  /* 该凭证最后一次写入时刻(Unix 毫秒): 多进程合并时取较新的一侧 */
  updatedAt: number
}

/* settings 块: 与 Config 字段一致的持久化形态(可缺省) */
export interface StoredSettings {
  enabled: boolean
  reportInterval: number
  reportEnabled: boolean
  includeTokens: boolean
  includePrompts: boolean
  debug: boolean
  /* 战绩表边框开关(纯展示项) */
  tableBorders?: boolean
  /* 数位分隔符(纯展示项) */
  digitGrouping?: 'thousand' | 'myriad'
  /* host 工具文案语言(Web UI 语言跟随 dsh web) */
  locale?: string
}

/* 本地持久化配置 */
export interface StoredConfig {
  /* 结构版本(用于数据迁移判定, 当前为 CONFIG_FILE_VERSION) */
  version: number
  /* 已保存的凭证(至多一份) */
  credential?: StoredCredential
  /* 凭证最后一次变更(写入或清除)时刻(Unix 毫秒): 多进程合并时按它取舍 */
  credentialUpdatedAt?: number
  /* settings 最后一次变更时刻(Unix 毫秒) */
  settingsUpdatedAt?: number
  /* 最近一次验证成功时的账号资料(缓存, 仅展示用) */
  userId?: string
  username?: string
  accountUpdatedAt?: number
  settings: StoredSettings
}

/* 配置管理器对外能力 */
export interface ConfigManager {
  /* 读取配置,不存在时返回 null;旧结构在此完成一次性迁移 */
  load(): Promise<StoredConfig | null>
  /* 写入配置:持锁读盘 -> 与磁盘内容合并 -> 原子写入;返回合并后的最终配置 */
  save(config: StoredConfig): Promise<StoredConfig>
  /* 检测其它进程是否改过文件(mtime 变化), 有变化时返回合并后的配置, 否则返回 null */
  refresh(): Promise<StoredConfig | null>
}

export { CONFIG_FILE_VERSION }
