/*
 * 全局常量与设计细节
 * 作者: JularDepick
 *
 * 可个性化修改但不影响插件核心功能的参数统一隔离在本文件,
 * 便于开发者知悉和维护,详情同步登记于 AGENTS.md 设计细节段。
 */

/* 翻译文件相关 */
export const DEFAULT_LANGUAGE = 'zh-CN'
export const FALLBACK_LANGUAGE = 'zh-CN'
export const TRANSLATION_DIR = 'translation'

/* 凭证与配置存放位置(相对用户主目录) */
export const CONFIG_DIR_NAME = 'wakatime'
export const CONFIG_FILE_NAME = 'config.json'

/* WakaTime REST API */
export const WAKATIME_API_BASE = 'https://wakatime.com/api/v1'
export const HEARTBEATS_PATH = '/users/current/heartbeats'
export const HEARTBEATS_BULK_PATH = '/users/current/heartbeats.bulk'
export const USER_INFO_PATH = '/users/current'

/* 定时上报 */
/* 上报周期默认值(秒):启动加载时上报一次,之后按此间隔循环批量上报 */
export const DEFAULT_REPORT_INTERVAL_SECONDS = 60
/* 批量上报单次上限(与 WakaTime bulk 接口约束对齐) */
export const BULK_HEARTBEAT_LIMIT = 25
export const RETRY_MAX_RETRIES = 5
export const RETRY_BASE_DELAY_MS = 1000
export const RETRY_MAX_DELAY_MS = 30000
export const RETRY_BACKOFF_MULTIPLIER = 2
export const OFFLINE_QUEUE_LIMIT = 1000
/* 离线队列补报周期(毫秒) */
export const OFFLINE_FLUSH_INTERVAL_MS = 30000
/* 上报记录日志保留条数(调试级,Web 展示) */
export const REPORT_LOG_LIMIT = 50

/* 心跳类别(对齐 WakaTime category 语义) */
export const HEARTBEAT_CATEGORY_AI = 'ai coding'
export const HEARTBEAT_CATEGORY_TOOL = 'debugging'

/* AI 会话全局标识:全部心跳归为一个整体 AI 会话,不再按 DSH 会话分开;
   取插件名称的合法标识(下划线形式,符合 WakaTime 字段约束) */
export const AI_SESSION_GLOBAL_ID = 'dsh_waka_time_plugin'

/* 提示词 Token 估算系数:字符数 ÷ 系数 ≈ Token 数(无官方 tokenizer 时的近似口径) */
export const PROMPT_TOKEN_ESTIMATE_DIVISOR = 1.5

/* Web UI 路由路径(挂在 dsh host webserver 上,仅 web profile 存在) */
export const WEB_STATUS_PATH = '/api/wakatime/status'
export const WEB_CONFIG_PATH = '/api/wakatime/config'
export const WEB_APIKEY_PATH = '/api/wakatime/apikey'
export const WEB_LOGS_PATH = '/api/wakatime/logs'

/* 环境变量 */
export const ENV_API_KEY = 'WAKATIME_API_KEY'
export const ENV_DEBUG = 'WAKATIME_DEBUG'
/* 覆盖凭证配置目录(测试与自托管场景使用) */
export const ENV_CONFIG_DIR = 'WAKATIME_CONFIG_DIR'
