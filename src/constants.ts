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

/* 凭证与配置存放位置(dsh home 的 plugins 下) */
export const CONFIG_DIR_NAME = 'wakatime'
export const CONFIG_FILE_NAME = 'config.json'

/* 分 Key 数据桶(与配置文件同目录):每个 API Key 一份本地数据(战绩累计、云端快照、
   待发送队列、失败任务与上报记录),未配置 API Key 期间的数据落在未指派桶;
   写入防抖(毫秒),避免高频统计变更频繁写盘 */
export const BUCKET_FILE_NAME = 'buckets.json'
export const BUCKET_FILE_VERSION = 1
export const BUCKET_SAVE_DEBOUNCE_MS = 2000
/* 桶静默期:未更新超过该天数的非当前 Key 桶,才允许用户在界面手动移除;
   本策略不自动清除任何桶(长期不用的 Key 数据保留,由用户决定何时移除) */
export const BUCKET_STALE_DAYS = 30
/* 展示用模糊 API Key:保留首尾各该字符数,其余以 * 代替(明文绝不出后端) */
export const KEY_MASK_EDGE_CHARS = 8
/* 待发送队列上限:超过即触发相邻两条合并压缩(保留较早那条 + AI 计数相加) */
export const PENDING_QUEUE_LIMIT = 5000
/* 失败任务列表上限与上报记录保留条数 */
export const FAILED_TASK_LIMIT = 500
/* 推送队列:积压达到该条数后按 积压 ÷ 该除数 合并成一次批量上报(不超过 bulk 上限) */
export const PUSH_BATCH_THRESHOLD = 20
export const PUSH_BATCH_DIVISOR = 10
/* 单条推送任务的最大尝试次数(含首次),耗尽后进入失败列表等待用户手动重试 */
export const PUSH_TASK_MAX_ATTEMPTS = 3
/* 旧版独立快照文件名(仅供一次性迁移读取) */
export const LEGACY_STATS_FILE_NAME = 'stats.json'
export const LEGACY_HEARTBEAT_FILE_NAME = 'heartbeats.json'

/* 项目与分支采样:Git 标记名、向上查找的最大层数、分支缓存时长(毫秒) */
export const GIT_DIR_NAME = '.git'
export const GIT_ROOT_MAX_DEPTH = 64
export const BRANCH_CACHE_TTL_MS = 5000

/* WakaTime REST API */
export const WAKATIME_API_BASE = 'https://wakatime.com/api/v1'
export const HEARTBEATS_PATH = '/users/current/heartbeats'
export const HEARTBEATS_BULK_PATH = '/users/current/heartbeats.bulk'
export const USER_INFO_PATH = '/users/current'
export const SUMMARIES_PATH = '/users/current/summaries'

/* WakaTime 匿名账号的 display_name 占位值(未设置用户名与姓名时由服务端返回),
   官方 /users/current 的 username 与 full_name 均可为 null,故展示账号名时需要剔除该占位 */
export const ANONYMOUS_DISPLAY_NAME = 'Anonymous User'

/* 云端同步:已配置 API Key 时拉取 summaries 的 AI 聚合(最近 7 天) */
export const CLOUD_SUMMARY_RANGE = 'last_7_days'
/* 云端同步结果缓存时长(毫秒):窗口内重复请求(切换标签页、刷新页面)直接复用,
   不重复请求 WakaTime;缓存按 API Key 归属,换 Key 自动失效 */
export const SYNC_CACHE_TTL_MS = 5 * 60 * 1000

/* 定时上报 */
/* 上报周期默认值(秒):启动加载时上报一次,之后按此间隔循环批量上报 */
export const DEFAULT_REPORT_INTERVAL_SECONDS = 60
/* 批量上报单次上限(与 WakaTime bulk 接口约束对齐) */
export const BULK_HEARTBEAT_LIMIT = 25
export const RETRY_MAX_RETRIES = 5
export const RETRY_BASE_DELAY_MS = 1000
export const RETRY_MAX_DELAY_MS = 30000
export const RETRY_BACKOFF_MULTIPLIER = 2
/* 单次请求超时(毫秒;超时按网络失败进入重试,避免挂起阻塞上报循环) */
export const REQUEST_TIMEOUT_MS = 30000
/* 补报周期(毫秒):单队列多挂一个更高频的推送轮 */
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

/* 会话采集:进行中的步骤计时缓存上限(被中断的步骤不会继续累积,超限淘汰最旧的计时) */
export const STEP_TIMING_LIMIT = 512

/* Web UI 路由路径(挂在 dsh host webserver 上,仅 web profile 存在) */
export const WEB_STATUS_PATH = '/api/wakatime/status'
export const WEB_CONFIG_PATH = '/api/wakatime/config'
export const WEB_APIKEY_PATH = '/api/wakatime/apikey'
export const WEB_LOGS_PATH = '/api/wakatime/logs'
export const WEB_SYNC_PATH = '/api/wakatime/sync'
export const WEB_APIKEY_CLEAR_PATH = '/api/wakatime/apikey/clear'
/* 手动重试一条失败推送任务 */
export const WEB_RETRY_PATH = '/api/wakatime/retry'
/* API Key 缓存(数据桶)清单与手动移除 */
export const WEB_BUCKETS_PATH = '/api/wakatime/buckets'
export const WEB_BUCKET_REMOVE_PATH = '/api/wakatime/bucket/remove'

/* 环境变量 */
export const ENV_API_KEY = 'WAKATIME_API_KEY'
export const ENV_DEBUG = 'WAKATIME_DEBUG'
/* 覆盖凭证配置目录(测试与自托管场景使用) */
export const ENV_CONFIG_DIR = 'WAKATIME_CONFIG_DIR'
/* dsh home 覆盖项(默认 home 推导用,与 dsh 本体的 DSH_HOME 对齐) */
export const ENV_DSH_HOME = 'DSH_HOME'
