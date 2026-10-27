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

/* 本地数据文件(与配置文件同目录):全插件一份数据(战绩累计、云端快照、
   待发送队列、失败任务与上报记录),与凭证无关 */
/* 数据文件名沿用历史名称(buckets.json), 避免 0.3.0 与 0.4.0 并存时各写一份文件导致数据分裂 */
export const BUCKET_FILE_NAME = 'buckets.json'
/* 数据文件结构版本: 0.3.0 为 2(分凭证数据桶), 0.4.0 起为 3(单份本地数据) */
export const STORE_FILE_VERSION = 3
/* 配置文件结构版本: 0.3.0 及更早无该字段, 0.4.0 起为 3 */
export const CONFIG_FILE_VERSION = 3
/* 统计变更触发落盘的防抖窗口(毫秒):避免高频统计变更频繁写盘 */
export const BUCKET_SAVE_DEBOUNCE_MS = 2000
/* 跨进程互斥:锁文件名与等待参数(同一数据目录可能被多个 dsh profile 进程同时写入) */
export const BUCKET_LOCK_FILE_NAME = 'buckets.lock'
export const CONFIG_LOCK_FILE_NAME = 'config.lock'
/* 锁文件超过该时长视为陈旧锁(持有进程异常退出) */
export const STORAGE_LOCK_TTL_MS = 10_000
/* 抢锁重试次数与退避基数(按次数线性递增) */
export const STORAGE_LOCK_RETRIES = 3
export const STORAGE_LOCK_BACKOFF_MS = 50
/* 展示用模糊凭证:保留首尾各该字符数,其余以 * 代替(明文绝不出后端) */
export const KEY_MASK_EDGE_CHARS = 8
/* 打码中间段固定星号个数(不按实际隐藏位数展开, 避免长度泄露与视觉噪音) */
export const KEY_MASK_STARS = 8
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
/* 账号资料接口(读取面) */
export const USER_INFO_PATH = '/users/current'
export const SUMMARIES_PATH = '/users/current/summaries'

/* WakaTime 匿名账号的 display_name 占位值(未设置用户名与姓名时由服务端返回),
   官方 /users/current 的 username 与 full_name 均可为 null,故展示账号名时需要剔除该占位 */
export const ANONYMOUS_DISPLAY_NAME = 'Anonymous User'

/* 凭证前缀(用于自动识别类型, 无需用户选择):
   插件密钥形如 waka_ 加 UUID(共 41 字符),
   OAuth 访问令牌形如 waka_tok_ 加随机串,
   OAuth 应用密钥形如 waka_sec_ 加随机串(属客户端密钥, 不能当凭证使用) */
export const CREDENTIAL_PREFIX_API_KEY = 'waka_'
export const CREDENTIAL_PREFIX_OAUTH = 'waka_tok_'
export const CREDENTIAL_PREFIX_SECRET = 'waka_sec_'
/* 可作为凭证接受的最短长度(前缀之外仍需足够长度) */
export const CREDENTIAL_MIN_LENGTH = 20
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
/* 账号名解析失败的负缓存时长(毫秒):避免每次状态查询都外呼注定失败的资料接口 */
export const USER_PROFILE_FAILURE_TTL_MS = 3_600_000
/* 状态查询里账号名解析的超时(毫秒):离线时不能把界面卡在 30 秒的请求超时上 */
export const USER_PROFILE_STATUS_TIMEOUT_MS = 3_000
/* 补报周期(毫秒):单队列多挂一个更高频的推送轮 */
export const OFFLINE_FLUSH_INTERVAL_MS = 30000
/* 上报记录日志保留条数(调试级,Web 展示) */
export const REPORT_LOG_LIMIT = 50

/* 数位分隔符的每组位数:千位 3 位一组,万位 4 位一组,统一插入英文逗号 */
export const DIGIT_GROUP_SIZES = { thousand: 3, myriad: 4 } as const

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
/* 凭证: 添加(自动识别类型) / 切换 / 移除 / 清除, 以及缓存清单 */
export const WEB_CREDENTIAL_PATH = '/api/wakatime/credential'
export const WEB_LOGS_PATH = '/api/wakatime/logs'
export const WEB_SYNC_PATH = '/api/wakatime/sync'
export const WEB_CREDENTIAL_CLEAR_PATH = '/api/wakatime/credential/clear'
/* 手动重试一条失败推送任务 */
export const WEB_RETRY_PATH = '/api/wakatime/retry'

/* 环境变量 */
/* OAuth 访问令牌环境变量(优先于配置文件) */
export const ENV_OAUTH_TOKEN = 'WAKATIME_OAUTH_TOKEN'
export const ENV_DEBUG = 'WAKATIME_DEBUG'
/* 覆盖凭证配置目录(测试与自托管场景使用) */
export const ENV_CONFIG_DIR = 'WAKATIME_CONFIG_DIR'
/* dsh home 覆盖项(默认 home 推导用,与 dsh 本体的 DSH_HOME 对齐) */
export const ENV_DSH_HOME = 'DSH_HOME'

/* 凭证被拒(401/403)时上报记录的节流间隔(毫秒): 凭证持续失效期间每轮推送都会命中,
   不节流会把上报记录上限挤满 */
export const CREDENTIAL_REJECT_LOG_INTERVAL_MS = 300_000
/* 等待在途推送结算的最大轮数:持续有在途推送时不再无限等待,避免手动重试接口被挂住 */
export const IDLE_WAIT_MAX_ROUNDS = 3
/* 手动同步(强制刷新)的自定请求头:强制刷新会驱动 host 向 WakaTime 外呼,
   无 Origin 的子资源请求(如 <img>)带不上自定头,故用它拦住跨站触发 */
export const SYNC_FORCE_HEADER = 'x-dsh-wakatime-force'
