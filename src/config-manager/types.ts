/*
 * 配置管理模块类型定义
 * 作者: JularDepick
 *
 * 0.5.0 起本地保存两槽凭证(写入槽 API Key, 读取槽 OAuth 令牌), 每槽可独立更换与清除;
 * 本地数据与凭证无关, 故清除凭证不影响战绩. 明文只在本文件与 host 进程内出现.
 */

import { CONFIG_FILE_VERSION } from '../constants'

/* 已保存的凭证(明文不回显): 每槽一份 */
export interface StoredCredentialSlot {
  /* 凭证原文(仅本地保存) */
  secret: string
  /* 凭证类型: 写入槽固定 api_key, 读取槽固定 oauth */
  type: 'api_key' | 'oauth'
  /* 该槽凭证最后一次写入时刻(Unix 毫秒): 多进程合并时取较新的一侧 */
  updatedAt: number
}

/* 两槽同账号的取证结论; 记录取证时的两槽时间戳, 与当前槽位不符即视为失效 */
export interface StoredSameAccount {
  verdict: 'same' | 'different' | 'unknown'
  writeUpdatedAt: number
  readUpdatedAt: number
  checkedAt: number
}

/* settings 块: 只记录用户在界面上显式改过的键(可缺省).
   缺省的键回落到 cordis.yml 的配置, 因此这里不能写入默认值, 否则界面上任意一次写入
   都会把全部配置项钉死, 之后修改 cordis.yml 静默失效 */
export interface StoredSettings {
  enabled?: boolean
  reportInterval?: number
  reportEnabled?: boolean
  includeTokens?: boolean
  includePrompts?: boolean
  debug?: boolean
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
  /* 写入槽凭证(API Key, 心跳上报) */
  writeCredential?: StoredCredentialSlot
  /* 写入槽最后一次变更(写入或清除)时刻(Unix 毫秒) */
  writeCredentialUpdatedAt?: number
  /* 读取槽凭证(OAuth 令牌, 账号资料与云端战绩) */
  readCredential?: StoredCredentialSlot
  /* 读取槽最后一次变更(写入或清除)时刻(Unix 毫秒) */
  readCredentialUpdatedAt?: number
  /* settings 最后一次变更时刻(Unix 毫秒) */
  settingsUpdatedAt?: number
  /* 最近一次验证成功时的账号资料(由读取槽解析, 缓存, 仅展示用) */
  userId?: string
  username?: string
  accountUpdatedAt?: number
  /* 最近一次保存写入槽时探测到的写权限 */
  writeScope?: 'ok' | 'missing' | 'unknown'
  /* 两槽同账号的取证结论(带取证时的槽位时间戳) */
  sameAccount?: StoredSameAccount
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
