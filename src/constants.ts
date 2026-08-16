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

/* WakaTime OAuth 2.0 端点与参数 */
export const OAUTH_AUTHORIZE_URL = 'https://wakatime.com/oauth/authorize'
export const OAUTH_TOKEN_URL = 'https://wakatime.com/oauth/token'
export const OAUTH_REVOKE_URL = 'https://wakatime.com/oauth/revoke'
export const DEFAULT_CALLBACK_PORT = 5843
export const OAUTH_CALLBACK_PATH = '/callback'
/* 申请范围:写入心跳、读取统计、邮箱 */
export const OAUTH_SCOPES = 'write_heartbeats read_stats email'
/* 用户已创建的 OAuth App 标识;client_secret 经配置或环境变量注入 */
export const DEFAULT_CLIENT_ID = 'UVjadZdHJNKHk417kz35oFNK'
export const TOKEN_REFRESH_THRESHOLD_SECONDS = 300

/* WakaTime REST API */
export const WAKATIME_API_BASE = 'https://wakatime.com/api/v1'
export const HEARTBEATS_PATH = '/users/current/heartbeats'
export const HEARTBEATS_BULK_PATH = '/users/current/heartbeats.bulk'
export const USER_INFO_PATH = '/users/current'

/* 心跳上报 */
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 120
export const BULK_HEARTBEAT_LIMIT = 25
export const RETRY_MAX_RETRIES = 5
export const RETRY_BASE_DELAY_MS = 1000
export const RETRY_MAX_DELAY_MS = 30000
export const RETRY_BACKOFF_MULTIPLIER = 2
export const OFFLINE_QUEUE_LIMIT = 1000
/* 离线队列补报周期(毫秒) */
export const OFFLINE_FLUSH_INTERVAL_MS = 30000

/* 心跳类别(对齐 WakaTime category 语义) */
export const HEARTBEAT_CATEGORY_AI = 'ai coding'
export const HEARTBEAT_CATEGORY_TOOL = 'debugging'

/* Web UI 路由路径(挂在 dsh host webserver 上,仅 web profile 存在) */
export const WEB_STATUS_PATH = '/api/wakatime/status'
export const WEB_CONFIG_PATH = '/api/wakatime/config'

/* 环境变量 */
export const ENV_CLIENT_ID = 'WAKATIME_CLIENT_ID'
export const ENV_CLIENT_SECRET = 'WAKATIME_CLIENT_SECRET'
export const ENV_DEBUG = 'WAKATIME_DEBUG'
/* 覆盖凭证配置目录(测试与自托管场景使用) */
export const ENV_CONFIG_DIR = 'WAKATIME_CONFIG_DIR'