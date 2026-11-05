/*
 * 认证管理模块实现
 * 作者: JularDepick
 *
 * 0.5.0 起凭证分两槽: 写入槽(API Key)负责心跳上报, 读取槽(个人 OAuth 令牌)负责账号资料与
 * 云端战绩. 官方把 API Key 限定为写入专用、个人令牌限定为读取专用, 单凭证无法同时满足
 * 「能写」与「能读」, 故两槽并存; 两槽缺一即视为未配置(上报暂停但队列保留),
 * 且两槽必须指向同一个 WakaTime 用户(保存时取证, 见 same-account.ts).
 * 明文只存在于 host 进程与配置文件(0600), 任何读取面只下发打码值.
 */

import {
  ANONYMOUS_DISPLAY_NAME,
  CLOUD_SUMMARY_RANGE,
  CONFIG_FILE_VERSION,
  ENV_API_KEY,
  ENV_OAUTH_TOKEN,
  HEARTBEATS_PATH,
  SUMMARIES_PATH,
  USER_INFO_PATH,
  USER_PROFILE_FAILURE_TTL_MS,
  USER_PROFILE_STATUS_TIMEOUT_MS,
} from '../constants'
import type { ConfigManager, StoredConfig, StoredCredentialSlot } from '../config-manager'
import type { CredentialRejectReason, CredentialSlot } from '../credential-format'
import { detectSlotCredential, maskCredential } from '../credential-format'
import type { CredentialErrorCode } from '../errors'
import { CredentialInputError, NotAuthenticatedError } from '../errors'
import type { AuthHeader, HttpClient } from '../http'
import { WakaTimeError } from '../http'
import { ApiKeyCredential, OauthCredential } from './credential'
import { probeSameAccount } from './same-account'
import type { AuthManager, AuthStatus, SameAccountVerdict, SetCredentialResult, SlotStatus, UserProfile } from './types'

/* /users/current 响应中用于解析账号名的字段(官方 username 与 full_name 均可为 null) */
export interface ProfileFields {
  id?: string
  username?: string | null
  display_name?: string | null
  full_name?: string | null
  email?: string | null
}

/* 日志出口(取证清理与账号解析留痕) */
export interface AuthLogger {
  warn?: (message: string) => void
}

/* 是否为匿名占位显示名(服务端在未设置用户名与姓名时返回的固定值) */
function isAnonymousPlaceholder(value: string): boolean {
  return value.toLowerCase() === ANONYMOUS_DISPLAY_NAME.toLowerCase()
}

/* 解析展示用账号名:依次取 username、full_name、display_name、email、id,
   跳过空值与匿名占位;全部不可用时返回 undefined(界面只显示已配置状态) */
export function pickUsername(user: ProfileFields): string | undefined {
  const candidates = [user.username, user.full_name, user.display_name, user.email, user.id]
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (!value || isAnonymousPlaceholder(value)) continue
    return value
  }
  return undefined
}

/* 给异步操作加超时:超时按失败处理,避免状态查询被网络请求拖住;
   超时时经信号一并中止底层请求, 不让已无用的请求继续占用连接 */
function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ms)
  timer.unref?.()
  return task(controller.signal).finally(() => { clearTimeout(timer) })
}

/* 首次落盘的配置骨架: settings 留空.
   若在这里写入默认值, 用户仅仅保存一次凭证就会把上报相关配置项钉死,
   之后修改 cordis.yml 的同名项静默失效 */
function emptyConfig(): StoredConfig {
  return { version: CONFIG_FILE_VERSION, settings: {} }
}

/* 识别失败原因 -> 稳定错误码(界面按码翻译): unknown 在旧口径里叫 unknown_format, 其余同名 */
function rejectCode(reason: CredentialRejectReason): CredentialErrorCode {
  return reason === 'unknown' ? 'unknown_format' : reason
}

export class AuthManagerImpl implements AuthManager {
  /* 配置内存缓存(含凭证);任何写入后同步更新 */
  private stored: StoredConfig | null = null
  /* 账号名解析失败时刻:窗口内不再外呼资料接口 */
  private profileFailureAt = 0
  /* 已告警过的环境变量槽位(避免每轮状态查询都重复告警) */
  private readonly envWarned = new Set<CredentialSlot>()
  private loaded = false
  /* 凭证变更订阅者(作废云端快照等副作用由调用方处理) */
  private readonly listeners = new Set<() => void>()
  private readonly logger?: AuthLogger

  constructor(
    private readonly http: HttpClient,
    private readonly configManager: ConfigManager,
    logger?: AuthLogger,
  ) {
    this.logger = logger
  }

  /* 订阅凭证变更(保存/清除后触发);返回取消订阅函数 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /* 写入槽凭证原文;未配置时返回 null */
  async getWriteSecret(): Promise<string | null> {
    return this.slotSecret('write')
  }

  /* 读取槽凭证原文;未配置时返回 null */
  async getReadSecret(): Promise<string | null> {
    return this.slotSecret('read')
  }

  /* 写入槽认证头;两槽缺一、两槽不同账号时抛 NotAuthenticatedError.
     上报按「配置完整才推送」的口径: 只配好写入槽就推, 登录面会看起来正常却缺少账号与战绩,
     两个状态来回跳, 故要求两槽齐备才推送(心跳留在队列, 补齐后自动续传) */
  async getWriteAuthHeader(): Promise<AuthHeader> {
    const secret = await this.slotSecret('write')
    if (secret === null) throw new NotAuthenticatedError()
    if ((await this.slotSecret('read')) === null) throw new NotAuthenticatedError()
    /* 两槽已确认不是同一个账号时拒绝写入: 否则心跳会进错账号的报表.
       任一槽来自环境变量时落盘结论对不上当前生效的凭证(状态接口此时也报 unknown), 故不据此拦停 */
    const envInvolved = this.envSecret('write') !== null || this.envSecret('read') !== null
    if (!envInvolved && this.sameAccountOf(this.stored) === 'different') throw new NotAuthenticatedError()
    return new ApiKeyCredential(secret).authHeader()
  }

  /* 读取槽认证头;未配置时抛 NotAuthenticatedError */
  async getReadAuthHeader(): Promise<AuthHeader> {
    const secret = await this.slotSecret('read')
    if (secret === null) throw new NotAuthenticatedError()
    if (this.sameAccountOf(this.stored) === 'different') throw new NotAuthenticatedError()
    return new OauthCredential(secret).authHeader()
  }

  /* 保存单槽凭证:格式校验 -> 服务端验证 -> 同账号取证 -> 覆盖落盘;验证失败不落盘.
     该槽由环境变量提供时保存不会生效, 直接拒绝并提示移除环境变量 */
  async setCredential(slot: CredentialSlot, input: string): Promise<SetCredentialResult> {
    if (this.envSecret(slot) !== null) throw new CredentialInputError('env_locked')
    const detection = detectSlotCredential(input, slot)
    if (!detection.ok) throw new CredentialInputError(rejectCode(detection.reason))
    const secret = input.trim()
    const stored = (await this.config()) ?? emptyConfig()
    const now = Date.now()

    /* 逐槽验证: 读取槽有读取面可校验身份, 写入槽只能靠一次空载荷写入探测 */
    let profile: UserProfile = {}
    let writeScope: 'ok' | 'missing' | 'unknown' | undefined
    if (slot === 'write') {
      writeScope = await this.probeWriteScope(secret)
      if (writeScope === 'missing') throw new CredentialInputError('write_scope')
      if (writeScope !== 'ok') throw new CredentialInputError('network')
    } else {
      try {
        profile = await this.validateReadSecret(secret)
      } catch (error) {
        /* 读取槽被服务端拒绝与写入槽同等对待: 给稳定错误码, 不让它落成小后端的 500 */
        if (error instanceof WakaTimeError && (error.status === 401 || error.status === 403)) {
          throw new CredentialInputError('read_scope')
        }
        if (error instanceof WakaTimeError && (error.status === 0 || error.status >= 500)) throw new CredentialInputError('network')
        throw error
      }
    }

    /* 另一次取证的槽位凭证: 已存配置或环境变量 */
    const writeSecret = slot === 'write' ? secret : await this.slotSecret('write')
    const readSecret = slot === 'read' ? secret : await this.slotSecret('read')
    const verdict = await this.checkSameAccount(writeSecret, readSecret)
    /* 两槽不属于同一个用户: 拒绝保存, 让用户改填同一个账号的凭证 */
    if (verdict === 'different') {
      this.logger?.warn?.('[wakatime] rejected credential: the two slots belong to different accounts')
      throw new CredentialInputError('different_account')
    }

    const previous = this.storedSlot(stored, slot)
    const existed = previous?.secret === secret
    const replaced = previous !== undefined && !existed
    const record: StoredCredentialSlot = {
      secret,
      type: slot === 'write' ? 'api_key' : 'oauth',
      updatedAt: now,
    }
    /* 换读取槽凭证时账号缓存必须整体替换: 解析不到新账号名就清空, 否则会一直显示上一个账号 */
    const { userId: _oldUserId, username: _oldUsername, accountUpdatedAt: _oldAccountAt, ...rest } = stored
    const writeUpdatedAt = slot === 'write' ? now : (stored.writeCredentialUpdatedAt ?? 0)
    const readUpdatedAt = slot === 'read' ? now : (stored.readCredentialUpdatedAt ?? 0)
    const next: StoredConfig = {
      ...rest,
      version: CONFIG_FILE_VERSION,
      ...(slot === 'write'
        ? { writeCredential: record, writeCredentialUpdatedAt: now, writeScope }
        : { readCredential: record, readCredentialUpdatedAt: now }),
      /* 账号资料只由读取槽的验证结果推进 */
      ...(slot === 'read'
        ? {
            ...(profile.userId === undefined ? {} : { userId: profile.userId }),
            ...(profile.username === undefined ? {} : { username: profile.username }),
            accountUpdatedAt: now,
          }
        : {
            ...(stored.userId === undefined ? {} : { userId: stored.userId }),
            ...(stored.username === undefined ? {} : { username: stored.username }),
            ...(stored.accountUpdatedAt === undefined ? {} : { accountUpdatedAt: stored.accountUpdatedAt }),
          }),
      sameAccount: { verdict, writeUpdatedAt, readUpdatedAt, checkedAt: now },
    }
    await this.setStored(next)
    const otherSlot: CredentialSlot = slot === 'write' ? 'read' : 'write'
    return {
      slot,
      maskedSecret: maskCredential(secret),
      ...(profile.username === undefined ? {} : { username: profile.username }),
      existed,
      replaced,
      updatedAt: now,
      ...(writeScope === undefined ? {} : { writeScope }),
      sameAccount: verdict,
      paired: (await this.slotSecret(otherSlot)) !== null,
    }
  }

  /* 探测写入权限(同时是 API Key 唯一的有效性验证): 发一条故意不合法的写入,
     服务端先校验凭证与 scope 再校验载荷, 缺权限回 401/403(不写入任何数据),
     有权限回 400/422; 网络异常返回 unknown 且不被当成可用 */
  private async probeWriteScope(secret: string): Promise<'ok' | 'missing' | 'unknown'> {
    try {
      await this.http.request(HEARTBEATS_PATH, {
        method: 'POST',
        body: {},
        auth: new ApiKeyCredential(secret).authHeader(),
        noRetry: true,
        maxRetries: 0,
      })
      return 'ok'
    } catch (error) {
      if (error instanceof WakaTimeError) {
        if (error.status === 401 || error.status === 403) return 'missing'
        if (error.status === 400 || error.status === 422) return 'ok'
      }
      return 'unknown'
    }
  }

  /* 两槽同账号取证: 任一槽缺失时无法确认 */
  private async checkSameAccount(writeSecret: string | null, readSecret: string | null): Promise<SameAccountVerdict> {
    if (writeSecret === null || readSecret === null) return 'unknown'
    return probeSameAccount(
      this.http,
      new ApiKeyCredential(writeSecret).authHeader(),
      new OauthCredential(readSecret).authHeader(),
      this.logger,
    )
  }

  /* 清除凭证: 缺省清两槽(本地数据保留); 只清读取槽时账号缓存一并丢弃.
     由环境变量提供的槽位清不掉(配置改不动), 这些槽位不阻断另一槽的清除,
     直接跳过并作为返回值交给调用方提示; 两槽都被环境变量占用时才算失败 */
  async clearCredential(slot?: CredentialSlot): Promise<CredentialSlot[]> {
    const targets: CredentialSlot[] = slot === undefined ? ['write', 'read'] : [slot]
    const locked = targets.filter((target) => this.envSecret(target) !== null)
    if (locked.length === targets.length) throw new CredentialInputError('env_locked')
    const stored = await this.config()
    if (!stored) return locked
    const clearWrite = targets.includes('write') && !locked.includes('write')
    const clearRead = targets.includes('read') && !locked.includes('read')
    /* 只有待清的槽位本来都是空时才无事可做: 否则即使目标槽为空也要推进该槽的变更时刻,
       让其它进程与本进程看到"这次清除"已经发生(并把云端快照作废一次) */
    const writeEmpty = stored.writeCredential === undefined
    const readEmpty = stored.readCredential === undefined
    if ((!clearWrite || writeEmpty) && (!clearRead || readEmpty)) return locked
    const now = Date.now()
    const { writeCredential: _write, writeScope: _scope, readCredential: _read, userId: _userId, username: _username, accountUpdatedAt: _accountAt, sameAccount: _same, ...rest } = stored
    await this.setStored({
      ...rest,
      version: CONFIG_FILE_VERSION,
      ...(clearWrite
        ? { writeCredentialUpdatedAt: now }
        : {
            ...(stored.writeCredential === undefined ? {} : { writeCredential: stored.writeCredential }),
            writeCredentialUpdatedAt: stored.writeCredentialUpdatedAt ?? 0,
            ...(stored.writeScope === undefined ? {} : { writeScope: stored.writeScope }),
          }),
      ...(clearRead
        ? { readCredentialUpdatedAt: now, accountUpdatedAt: now }
        : {
            ...(stored.readCredential === undefined ? {} : { readCredential: stored.readCredential }),
            readCredentialUpdatedAt: stored.readCredentialUpdatedAt ?? 0,
            ...(stored.userId === undefined ? {} : { userId: stored.userId }),
            ...(stored.username === undefined ? {} : { username: stored.username }),
            ...(stored.accountUpdatedAt === undefined ? {} : { accountUpdatedAt: stored.accountUpdatedAt }),
          }),
    })
    return locked
  }

  async getStatus(): Promise<AuthStatus> {
    const stored = await this.config()
    const writeSecret = await this.slotSecret('write')
    const readSecret = await this.slotSecret('read')
    const write = this.slotStatus('write', stored, writeSecret)
    const read = this.slotStatus('read', stored, readSecret)
    const configured = writeSecret !== null && readSecret !== null
    /* 环境变量提供的槽位没有落盘时间戳, 取证结论无法对齐, 一律按未知处理 */
    const sameAccount: SameAccountVerdict = write.fromEnv || read.fromEnv ? 'unknown' : this.sameAccountOf(stored)
    const base: AuthStatus = {
      configured,
      fromEnv: write.fromEnv || read.fromEnv,
      write,
      read,
      sameAccount,
      ...(stored?.writeScope === undefined || write.fromEnv ? {} : { writeScope: stored.writeScope }),
    }
    /* 账号名只依赖读取槽: 只配好读取槽时也解析出来, 让界面能显示"哪个账号已就位" */
    if (readSecret === null) return base
    const username = await this.resolveUsername(stored)
    return username === undefined ? base : { ...base, username }
  }

  /* 单槽状态(不含明文) */
  private slotStatus(slot: CredentialSlot, stored: StoredConfig | null, secret: string | null): SlotStatus {
    const fromEnv = this.envSecret(slot) !== null
    if (secret === null) return { configured: false, fromEnv }
    const record = this.storedSlot(stored, slot)
    return {
      configured: true,
      fromEnv,
      maskedSecret: maskCredential(secret),
      /* 环境变量凭证优先于文件凭证: 此时磁盘上的写入时刻属于被覆盖的那一份, 不下发免得误读 */
      ...(record === undefined || fromEnv ? {} : { updatedAt: record.updatedAt }),
    }
  }

  /* 读取槽凭证校验:
       - 先试账号资料接口(官方标注需 email scope):成功即有效, 并带回账号名;
       - 被 401/403 拒绝时退战绩接口(需 read_summaries)确认, 战绩可用即视为有效;
       - 网络异常一律拒绝, 避免把拼写错误当成可用凭证 */
  private async validateReadSecret(secret: string): Promise<UserProfile> {
    const header = new OauthCredential(secret).authHeader()
    try {
      return await this.fetchUserProfile(header)
    } catch (error) {
      if (!(error instanceof WakaTimeError) || (error.status !== 401 && error.status !== 403)) throw error
      /* 凭证校验是交互式路径, 只重试一次:失败要尽快把结论交回调用方, 不做长退避 */
      await this.http.request(`${SUMMARIES_PATH}?range=${CLOUD_SUMMARY_RANGE}`, {
        method: 'GET',
        auth: header,
        maxRetries: 1,
      })
      return {}
    }
  }

  /* 用认证头拉取账号资料并验证有效性:HTTP 非 2xx(如 401)或网络异常
     视为凭证无效,抛出 WakaTimeError;成功时账号名经 pickUsername 解析 */
  async fetchUserProfile(header: AuthHeader, signal?: AbortSignal): Promise<UserProfile> {
    const data = await this.http.request<{ data?: ProfileFields }>(
      USER_INFO_PATH,
      { method: 'GET', auth: header, maxRetries: 1, signal },
    )
    /* 校验必须看到身份字段: 网关返回 HTML 或重定向页时 HTTP 仍是 2xx,
       不能把这种响应当成"凭证有效" */
    const user = data?.data
    if (typeof user !== 'object' || user === null) {
      throw new WakaTimeError(0, 'unexpected profile response')
    }
    const id = typeof user.id === 'string' ? user.id.trim() : ''
    const hasUsername = typeof user.username === 'string' && user.username.trim() !== ''
    const hasName = typeof user.full_name === 'string' && user.full_name.trim() !== ''
    if (id === '' && !hasUsername && !hasName) {
      throw new WakaTimeError(0, 'unexpected profile response')
    }
    return { userId: user.id, username: pickUsername(user) }
  }

  /* 读取槽的某一槽凭证原文 */
  private async slotSecret(slot: CredentialSlot): Promise<string | null> {
    const fromEnv = this.envSecret(slot)
    if (fromEnv !== null) return fromEnv
    const stored = await this.config()
    return this.storedSlot(stored, slot)?.secret ?? null
  }

  /* 从落盘配置里取某个槽的凭证记录 */
  private storedSlot(stored: StoredConfig | null, slot: CredentialSlot): StoredCredentialSlot | undefined {
    return slot === 'write' ? stored?.writeCredential : stored?.readCredential
  }

  /* 已落盘的取证结论是否仍然对应当前的两槽: 任一槽变更后结论失效 */
  private sameAccountOf(stored: StoredConfig | null): SameAccountVerdict {
    const record = stored?.sameAccount
    if (record === undefined) return 'unknown'
    if (record.writeUpdatedAt !== (stored?.writeCredentialUpdatedAt ?? 0)) return 'unknown'
    if (record.readUpdatedAt !== (stored?.readCredentialUpdatedAt ?? 0)) return 'unknown'
    return record.verdict
  }

  /* 读取并缓存配置;首次读取时由 config-manager 完成旧结构迁移 */
  private async config(): Promise<StoredConfig | null> {
    if (!this.loaded) {
      this.stored = await this.configManager.load()
      this.loaded = true
      return this.stored
    }
    /* 后续读取:其它 profile 进程可能刚改过配置, 按 mtime 检查并并入内存 */
    const refreshed = await this.configManager.refresh()
    if (refreshed !== null) this.stored = refreshed
    return this.stored
  }

  /* 写入配置并通知订阅者 */
  private async setStored(next: StoredConfig): Promise<void> {
    this.stored = await this.configManager.save(next)
    this.loaded = true
    for (const listener of [...this.listeners]) listener()
  }

  /* 静默写入(仅刷新账号名缓存时不触发凭证变更副作用) */
  private async saveQuietly(next: StoredConfig): Promise<void> {
    this.stored = await this.configManager.save(next)
    this.loaded = true
  }

  /* 环境变量注入的凭证(不落盘): 写入槽用 WAKATIME_API_KEY, 读取槽用 WAKATIME_OAUTH_TOKEN.
     环境变量绕过保存链路(不做格式校验与同账号取证), 因此这里补一次形态检查并只告警一次:
     配错时不至于一直以"已配置"状态静默失败 */
  private envSecret(slot: CredentialSlot): string | null {
    const name = slot === 'write' ? ENV_API_KEY : ENV_OAUTH_TOKEN
    const token = process.env[name]?.trim()
    if (!token) return null
    if (!this.envWarned.has(slot) && !detectSlotCredential(token, slot).ok) {
      this.envWarned.add(slot)
      this.logger?.warn?.(`[wakatime] ${name} does not look like a valid ${slot === 'write' ? 'WakaTime API key' : 'OAuth access token'}, the slot may never work`)
    }
    return token
  }

  /* 展示用账号名:缓存值可用时直接返回;缺失或仍是匿名占位时用读取槽重新解析并回写,
     解析失败返回 undefined(不展示匿名占位,也不阻塞状态查询) */
  private async resolveUsername(stored: StoredConfig | null): Promise<string | undefined> {
    const cached = typeof stored?.username === 'string' ? stored.username.trim() : ''
    if (cached && !isAnonymousPlaceholder(cached)) return cached
    if (this.profileFailureAt > 0 && Date.now() - this.profileFailureAt < USER_PROFILE_FAILURE_TTL_MS) return undefined
    try {
      const secret = await this.slotSecret('read')
      if (secret === null || stored === null) return undefined
      const profile = await withTimeout(
        (signal) => this.fetchUserProfile(new OauthCredential(secret).authHeader(), signal),
        USER_PROFILE_STATUS_TIMEOUT_MS,
      )
      if (profile.username !== undefined && profile.username !== cached) {
        await this.saveQuietly({
          ...stored,
          ...(profile.userId === undefined ? {} : { userId: profile.userId }),
          username: profile.username,
          accountUpdatedAt: Date.now(),
        })
      }
      this.profileFailureAt = 0
      return profile.username
    } catch {
      this.profileFailureAt = Date.now()
      return undefined
    }
  }
}

export type { AuthManager, AuthStatus, SameAccountVerdict, SetCredentialResult, SlotStatus, UserProfile } from './types'
