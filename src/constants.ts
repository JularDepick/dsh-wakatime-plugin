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

/* 凭证与配置存放位置 */
export const CONFIG_DIR_NAME = 'wakatime'
export const CONFIG_FILE_NAME = 'config.json'

/* WakaTime OAuth 2.0 端点 */
export const OAUTH_AUTHORIZE_URL = 'https://wakatime.com/oauth/authorize'
export const OAUTH_TOKEN_URL = 'https://wakatime.com/oauth/token'
export const OAUTH_REVOKE_URL = 'https://wakatime.com/oauth/revoke'
export const DEFAULT_CALLBACK_PORT = 5843
export const TOKEN_REFRESH_THRESHOLD_SECONDS = 300

/* 心跳上报 */
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 120
export const BULK_HEARTBEAT_LIMIT = 25
export const RETRY_MAX_RETRIES = 5
export const RETRY_BASE_DELAY_MS = 1000
export const RETRY_MAX_DELAY_MS = 30000
export const RETRY_BACKOFF_MULTIPLIER = 2
export const OFFLINE_QUEUE_LIMIT = 1000

/* 环境变量 */
export const ENV_CLIENT_ID = 'WAKATIME_CLIENT_ID'
export const ENV_CLIENT_SECRET = 'WAKATIME_CLIENT_SECRET'
export const ENV_DEBUG = 'WAKATIME_DEBUG'