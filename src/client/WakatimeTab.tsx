/*
 * WakaTime 会话区域标签页组件
 * 作者: JularDepick
 *
 * Agent 协作战绩(全局):提示词字符总量(官方 ai_prompt_length 口径)、
 * 模型思考总时长、输出 TOKEN 总量、有效 TOKEN 消耗量(输入+输出)、
 * 平均输出速度(输出 TOKEN ÷ 思考秒数,向下取整)等;
 * API Key 覆盖管理(小后端代理,仅覆盖不可查看);
 * 上报记录日志(可展开/收起,调试级);主视图工具条左侧带只读账号状态,
 * API Key 变更与上报参数同属配置,由右上角按钮切换出的配置视图承载(ESC 切回主视图)。
 * 数据经 host webserver 接口读写(仅 web profile 提供)。
 * 语言跟随 dsh web UI 语言切换(字典经 locale 座位注入)。
 * 版式:内容直接铺在 tab 下,不再自建卡片(分区之间用分隔线区分),
 * 战绩为独立表格;字设与配色继承 profile 的 --dsw-font-* 与 --dsw-alias-* 令牌。
 * 官方控件形态自行复制(官方守则禁止外部插件 value-import Harness Client 包)。
 */

import { useEffect, useRef, useState } from 'react'
import { detectCredentialType } from '../credential-format'
import type { CSSProperties, MutableRefObject } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DIGIT_GROUP_SIZES } from '../constants'
import type { DigitGrouping } from '../config'
import { averageOutputSpeed, effectiveTokens, formatThinkingDuration, groupDigits } from '../metrics'
import type { WebBucketEntry, WebBucketRemoveResponse, WebBucketsResponse, WebCredentialResponse, WebLogEntry, WebStatusResponse, WebSyncResponse } from '../webui/types'
import css from './WakatimeTab.module.css'

/** 注册点推导的组件 props(conversation.view 会话座位不消费 + locale 座位) */
export type WakatimeTabProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'wakatime'>

/** 配置草稿:status.config 的可编辑子集(语言跟随 dsh web,不在配置区) */
interface ConfigDraft {
  enabled: boolean
  reportInterval: number
  reportEnabled: boolean
  includeTokens: boolean
  includePrompts: boolean
  debug: boolean
  tableBorders: boolean
  statsScope: 'all' | 'current'
  /* 数位分隔符:千位(3 位一组)/ 万位(4 位一组),纯展示项 */
  digitGrouping: DigitGrouping
}

/** 保存结果提示 */
interface Notice {
  kind: 'ok' | 'error'
  text: string
}

const STATUS_PATH = '/api/wakatime/status'
const CONFIG_PATH = '/api/wakatime/config'
const CREDENTIAL_PATH = '/api/wakatime/credential'
const CREDENTIAL_SWITCH_PATH = '/api/wakatime/credential/switch'
const CREDENTIAL_REMOVE_PATH = '/api/wakatime/credential/remove'
const CREDENTIAL_CLEAR_PATH = '/api/wakatime/credential/clear'
const LOGS_PATH = '/api/wakatime/logs'
const SYNC_PATH = '/api/wakatime/sync'
const RETRY_PATH = '/api/wakatime/retry'
const BUCKETS_PATH = '/api/wakatime/buckets'
const BUCKET_REMOVE_PATH = '/api/wakatime/bucket/remove'

/** 清除确认与提示停留时长:与官方 Toast 默认一致(1000ms 淡出另计) */
const CONFIRM_MS = 3000
const NOTICE_MS = 3000

/** 云端同步本地缓存时长(与服务端 SYNC_CACHE_TTL_MS 对齐):
 *  切换标签页会重新挂载组件,缓存命中时直接用上次结果,不再请求云端 */
const CLOUD_CACHE_MS = 5 * 60 * 1000

/* 模块级同步时间戳:同一页面会话内切换标签页不重复向小后端发起同步请求;
   云端数据本身已由服务端写入对应 Key 的数据桶,并另有服务端缓存 SYNC_CACHE_TTL_MS */
let lastSyncAt = 0

function syncedRecently(): boolean {
  return Date.now() - lastSyncAt < CLOUD_CACHE_MS
}

function markSynced(): void {
  lastSyncAt = Date.now()
}

function clearSynced(): void {
  lastSyncAt = 0
}

/** 紧凑次级按钮类名(官方 Button sm + outline) */
const compactButton = `${css.button} ${css.buttonSm} ${css.buttonOutline}`

/** 配置子页容器 id(供右上角按钮 aria-controls 指向) */
const CONFIG_PANEL_ID = 'wakatime-config-panel'

/**
 * 渲染 wakatime 标签页。
 * @param props - 框架座位:t 为 locale 座位,会话座位不消费。
 * @returns 战绩表、API Key 覆盖区、上报日志区与配置视图。
 */
export function WakatimeTab({ t }: WakatimeTabProps) {
  const [data, setData] = useState<WebStatusResponse | null>(null)
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  /* 输入框内容(插件密钥或 OAuth 访问令牌,类型由前缀自动识别) */
  const [credentialInput, setCredentialInput] = useState('')
  /* 等待二次确认移除的凭证/缓存标识 */
  const [credentialConfirm, setCredentialConfirm] = useState<string | undefined>(undefined)
  const [logs, setLogs] = useState<readonly WebLogEntry[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [keySaving, setKeySaving] = useState(false)
  const [tick, setTick] = useState(0)
  /* 云端同步状态(战绩数值与云端快照由服务端按数据桶解析后下发) */
  const [cloudState, setCloudState] = useState<'idle' | 'syncing' | 'error'>('idle')
  /* 清除 API Key 二次确认(3 秒内点击确认,超时回归) */
  const [clearConfirm, setClearConfirm] = useState(false)
  /* 配置视图开关(右上角按钮切换 tab 内容,ESC 切回主视图) */
  const [configOpen, setConfigOpen] = useState(false)
  const configToggleRef = useRef<HTMLButtonElement | null>(null)
  /* API Key 缓存明细(展开时才拉取):null 表示尚未拉取 */
  const [buckets, setBuckets] = useState<WebBucketEntry[] | null>(null)
  const [bucketsOpen, setBucketsOpen] = useState(false)
  /* 移除某个 Key 缓存的二次确认(3 秒内再次点击确认,超时回归) */
  const [bucketConfirm, setBucketConfirm] = useState<string | undefined>(undefined)

  /* 移除确认超时回归(缓存与凭证共用同一套二次确认规则) */
  useEffect(() => {
    if (bucketConfirm === undefined) return
    const timer = setTimeout(() => { setBucketConfirm(undefined) }, CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [bucketConfirm])

  useEffect(() => {
    if (credentialConfirm === undefined) return
    const timer = setTimeout(() => { setCredentialConfirm(undefined) }, CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [credentialConfirm])

  /* 清除确认超时回归 */
  useEffect(() => {
    if (!clearConfirm) return
    const timer = setTimeout(() => { setClearConfirm(false) }, CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [clearConfirm])

  /* 切回主视图后焦点回到切换按钮(首次挂载不抢焦点) */
  const configFocusReady = useRef(false)
  useEffect(() => {
    if (!configFocusReady.current) {
      configFocusReady.current = true
      return
    }
    if (!configOpen) configToggleRef.current?.focus()
  }, [configOpen])

  /* ESC 切回主视图(捕获阶段监听并阻断继续传播,避免宿主同时响应) */
  useEffect(() => {
    if (!configOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setConfigOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [configOpen])

  /* 清除全部已存凭证(回退未登录;本地缓存保留)并刷新状态 */
  const clearCredentials = (): void => {
    if (!clearConfirm) {
      setClearConfirm(true)
      return
    }
    setClearConfirm(false)
    fetch(CREDENTIAL_CLEAR_PATH, { method: 'POST' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        clearSynced()
        setCloudState('idle')
        setTick((value) => value + 1)
      })
      .catch(() => { setNotice({ kind: 'error', text: t('state.loadFailed') }) })
  }

  /* 云端同步:向小后端拉取 summaries AI 聚合(force 为手动刷新,跳过两侧缓存);
     服务端把结果写入当前 Key 的数据桶并返回解析好的战绩视图,前端直接替换展示数据 */
  const syncCloud = (force = false): void => {
    setCloudState('syncing')
    fetch(force ? `${SYNC_PATH}?force=1` : SYNC_PATH, { cache: 'no-store' })
      .then((response) => response.json() as Promise<WebSyncResponse>)
      .then((result) => {
        if (result.ok && result.data) {
          markSynced()
          setData((previous) => (previous ? { ...previous, stats: result.data as WebStatusResponse['stats'] } : previous))
          setCloudState('idle')
        } else {
          setCloudState('error')
        }
      })
      .catch(() => { setCloudState('error') })
  }

  /* 上报记录:失败行手动重试(移回推送队列并立即尝试一轮) */
  const retryLog = (id: string): void => {
    fetch(RETRY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: (error as Error).message }) })
  }

  /* 凭证操作错误码映射为字典文案(格式类错误码由前端直接给出) */
  const credentialErrorText = (code: string | undefined): string => {
    if (code === 'empty') return t('credential.errEmpty')
    if (code === 'client_secret') return t('credential.errClientSecret')
    if (code === 'unknown_format') return t('credential.errUnknownFormat')
    if (code === 'not_found') return t('credential.errNotFound')
    if (code === 'active') return t('credential.errActive')
    return code ?? ''
  }

  /* 切换激活凭证:切换后重新拉取清单与状态(每份凭证一个数据桶) */
  const switchCredential = (id: string): void => {
    fetch(CREDENTIAL_SWITCH_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then(async (response) => {
        const result = await response.json() as { ok: boolean; error?: string }
        if (!response.ok || !result.ok) throw new Error(credentialErrorText(result.error))
        return result
      })
      .then(() => {
        clearSynced()
        setCloudState('idle')
        loadBuckets()
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: (error as Error).message }) })
  }

  /* 移除一份凭证(连同其本地缓存):二次确认在同一按钮上完成 */
  const removeCredential = (id: string): void => {
    if (credentialConfirm !== id) {
      setCredentialConfirm(id)
      return
    }
    setCredentialConfirm(undefined)
    fetch(CREDENTIAL_REMOVE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then(async (response) => {
        const result = await response.json() as { ok: boolean; error?: string }
        if (!response.ok || !result.ok) throw new Error(credentialErrorText(result.error))
        return result
      })
      .then(() => {
        loadBuckets()
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: (error as Error).message }) })
  }

  /* 移除失败原因:稳定标识映射为字典文案 */
  const describeBucketError = (error: string | undefined): string => {
    if (error === 'bucket-in-use') return t('buckets.errInUse')
    if (error === 'bucket-not-removable') return t('buckets.errRecent')
    if (error === 'bucket-not-found') return t('buckets.errMissing')
    return error ?? ''
  }

  /* 拉取 API Key 缓存清单(含每个 Key 自己的战绩视图,均为服务端按落盘数据实时解析) */
  const loadBuckets = (): void => {
    fetch(BUCKETS_PATH, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<WebBucketsResponse>
      })
      .then((result) => { setBuckets(result.buckets) })
      .catch((error: unknown) => {
        setBuckets([])
        setNotice({ kind: 'error', text: (error as Error).message })
      })
  }

  /* 展开/收起缓存明细:展开时才拉取 */
  const toggleBuckets = (open: boolean): void => {
    setBucketsOpen(open)
    if (open) loadBuckets()
  }

  /* 移除一个 30 天未登录过的 Key 缓存(二次确认在同一按钮上完成);
     移除后重新拉取清单与状态,使落盘缓存与战绩表同步 */
  const removeBucket = (key: string): void => {
    if (bucketConfirm !== key) {
      setBucketConfirm(key)
      return
    }
    setBucketConfirm(undefined)
    fetch(BUCKET_REMOVE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    })
      .then(async (response) => {
        const result = await response.json() as WebBucketRemoveResponse
        if (!response.ok || !result.ok) throw new Error(describeBucketError(result.error))
        return result
      })
      .then(() => {
        loadBuckets()
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => {
        setNotice({ kind: 'error', text: `${t('buckets.removeFailed')}: ${(error as Error).message}` })
      })
  }

  /* 拉取状态与上报日志;已配置且本地无云端缓存时才同步 */
  const reload = (): void => {
    setLoadError(undefined)
    fetch(STATUS_PATH, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<WebStatusResponse>
      })
      .then((next) => {
        setData(next)
        setDraft(fromConfig(next.config))
        if (next.configured && !syncedRecently()) syncCloud()
        /* 缓存明细区已展开时同步刷新(切换/清除 Key 后当前密钥标记与列表会变) */
        if (bucketsOpen) loadBuckets()
      })
      .catch((error: unknown) => { setLoadError((error as Error).message) })
    fetch(LOGS_PATH, { cache: 'no-store' })
      .then((response) => response.json() as Promise<readonly WebLogEntry[]>)
      .then(setLogs)
      .catch(() => { setLogs([]) })
  }

  useEffect(() => { reload() }, [tick])

  /* 上报记录失败原因:稳定标识映射为字典文案,其余(如网络错误细节)原样展示 */
  const describeLogError = (error: string | undefined): string => {
    if (error === 'auth-missing') return t('logs.errNotConfigured')
    return error ?? ''
  }

  /* 提示停留后自动消失(与官方 Toast 的 3000ms 停留 + 1000ms 淡出一致) */
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => { setNotice(undefined) }, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const patch = (key: keyof ConfigDraft, value: ConfigDraft[keyof ConfigDraft]): void => {
    /* 值未变化时不重复写入(数字字段失焦时常见) */
    if (draft && draft[key] === value) return
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
    setNotice(undefined)
    /* 单键写入,小后端即时应用并持久化:配置改动无需保存按钮 */
    fetch(CONFIG_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      })
      .catch((error: unknown) => {
        setNotice({ kind: 'error', text: `${t('config.saveFailed')}: ${(error as Error).message}` })
        /* 写入失败:重新拉取状态,使草稿回到服务端已生效的值 */
        setTick((value) => value + 1)
      })
  }

  /* 数字字段输入过程只更新草稿,避免中间值(如 1)即时生效 */
  const draftOnly = (key: keyof ConfigDraft, value: ConfigDraft[keyof ConfigDraft]): void => {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
  }

  /* 凭证保存:前端先按前缀校验格式, 小后端再权威识别类型并验证有效性;
     成功后清空输入框并刷新状态(不弹成功飘窗) */
  const saveCredential = (): void => {
    const value = credentialInput.trim()
    /* 格式不通过时前端直接拦下, 不发请求 */
    if (!detectCredentialType(value).ok) return
    setKeySaving(true)
    setNotice(undefined)
    fetch(CREDENTIAL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: value }),
    })
      .then(async (response) => {
        const result = await response.json() as WebCredentialResponse
        if (!response.ok || !result.ok) {
          throw new Error(credentialErrorText(result.error) || `HTTP ${response.status}`)
        }
        return result
      })
      .then(() => {
        setCredentialInput('')
        /* 换了账号:同步节流与错误态重置,下次按新 Key 重新同步 */
        clearSynced()
        setCloudState('idle')
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => {
        setNotice({ kind: 'error', text: (error as Error).message })
      })
      .finally(() => { setKeySaving(false) })
  }

  return (
    <div className={css.tab}>
      <div className={css.column}>
        <div className={css.content}>
          {loadError !== undefined && data === null ? (
            <p className={css.error} role="status">
              {t('state.loadFailed')}:{loadError}
            </p>
          ) : null}

          {data === null || draft === null ? (
            loadError === undefined ? <p className={css.muted}>{t('state.loading')}</p> : null
          ) : (
            <WakatimePanels
              t={t}
              data={data}
              draft={draft}
              logs={logs}
              logsOpen={logsOpen}
              cloudState={cloudState}
              buckets={buckets}
              bucketsOpen={bucketsOpen}
              bucketConfirm={bucketConfirm}
              credentialInput={credentialInput}
              credentialConfirm={credentialConfirm}
              keySaving={keySaving}
              clearConfirm={clearConfirm}
              configOpen={configOpen}
              configToggleRef={configToggleRef}
              describeLogError={describeLogError}
              onToggleLogs={() => { setLogsOpen(!logsOpen) }}
              onToggleConfig={() => { setConfigOpen(!configOpen) }}
              onRefresh={() => { setTick((value) => value + 1) }}
              onSync={() => { syncCloud(true) }}
              onRetry={retryLog}
              onBucketsToggle={toggleBuckets}
              onRemoveBucket={removeBucket}
              onClearCredentials={clearCredentials}
              onCredentialInput={setCredentialInput}
              onSaveCredential={saveCredential}
              onSwitchCredential={switchCredential}
              onRemoveCredential={removeCredential}
              onPatch={patch}
              onDraft={draftOnly}
            />
          )}
        </div>
      </div>

      {notice ? (
        <div className={css.toast} role="status">
          <span className={css.toastText}>{notice.text}</span>
        </div>
      ) : null}
    </div>
  )
}

/** 面板属性(数据与回调均由主体下发,便于主体只负责数据编排) */
interface PanelsProps {
  t: (key: Parameters<WakatimeTabProps['t']>[0]) => string
  data: WebStatusResponse
  draft: ConfigDraft
  logs: readonly WebLogEntry[]
  logsOpen: boolean
  cloudState: 'idle' | 'syncing' | 'error'
  /* API Key 缓存明细(null 表示尚未拉取) */
  buckets: readonly WebBucketEntry[] | null
  bucketsOpen: boolean
  /* 等待二次确认移除的桶标识 */
  bucketConfirm: string | undefined
  credentialInput: string
  /* 等待二次确认移除的凭证标识 */
  credentialConfirm: string | undefined
  keySaving: boolean
  clearConfirm: boolean
  configOpen: boolean
  configToggleRef: MutableRefObject<HTMLButtonElement | null>
  describeLogError: (error: string | undefined) => string
  onToggleLogs: () => void
  onToggleConfig: () => void
  onRefresh: () => void
  onSync: () => void
  onRetry: (id: string) => void
  onBucketsToggle: (open: boolean) => void
  onRemoveBucket: (key: string) => void
  onClearCredentials: () => void
  onCredentialInput: (value: string) => void
  onSaveCredential: () => void
  onSwitchCredential: (id: string) => void
  onRemoveCredential: (id: string) => void
  onPatch: (key: keyof ConfigDraft, value: ConfigDraft[keyof ConfigDraft]) => void
  onDraft: (key: keyof ConfigDraft, value: ConfigDraft[keyof ConfigDraft]) => void
}

/**
 * 渲染主视图(只读账号状态 + 战绩 → 上报记录)或配置视图(API Key 变更 → 上报参数)。
 * 战绩为独立表格;分区之间用分隔线区分,不自建卡片;
 * 右上角按钮在两个视图之间切换 tab 内容(ESC 切回主视图)。
 * @param props - 数据、草稿与回调集合。
 * @returns 当前视图内容。
 */
function WakatimePanels(props: PanelsProps) {
  const { t, data, draft, logs, logsOpen, cloudState } = props
  const { buckets, bucketsOpen, bucketConfirm } = props
  const { credentialInput: apiKeyInput, credentialConfirm, keySaving, clearConfirm } = props
  const { configOpen, configToggleRef } = props
  const { describeLogError, onToggleLogs, onRefresh, onSync, onRetry, onClearCredentials, onToggleConfig } = props
  const { onCredentialInput: onApiKeyInput, onSaveCredential, onSwitchCredential, onRemoveCredential, onPatch, onDraft } = props
  const { onBucketsToggle, onRemoveBucket } = props
  /* 战绩视图由服务端按显示策略解析:桶内已与云端取最大,跨桶按策略求和 */
  const view = data.stats  /* 表格边框:配置项驱动(默认开启),关闭时退回仅横向分隔线的观感 */
  const bordered = draft.tableBorders ? 'true' : 'false'
  /* 数值展示的每组位数:千位 3 位、万位 4 位(两者都用英文逗号分隔) */
  const groupSize = DIGIT_GROUP_SIZES[draft.digitGrouping]
  const cloudMeta = view.cloud
    ? `${t('cloud.syncedAt')}: ${formatTime(view.cloud.syncedAt)}`
    : (cloudState === 'error' ? t('cloud.failed') : t('cloud.never'))

  /* 上报记录结果文案:成功 / 失败 / 已重试(重试行不关心重试结果) */
  const logStateText = (entry: WebLogEntry): string => {
    if (entry.ok) return t('logs.success')
    return entry.state === 'retried' ? t('logs.retried') : t('logs.failed')
  }

  /* 上报记录详情:失败原因(稳定标识映射)与本次上报内容摘要(类别计数与项目/分支);
     旧版记录没有摘要时回退为心跳对象 */
  const logDetail = (entry: WebLogEntry): string => {
    const reason = describeLogError(entry.error)
    const content = entry.detail ?? entry.entity ?? ''
    if (reason === '') return content
    return content === '' ? reason : `${reason} · ${content}`
  }

  /* 视图切换按钮:主视图与配置视图共用(靠右,主视图左侧留给只读账号状态) */
  const toggleButton = (
    <button
      type="button"
      ref={configToggleRef}
      className={`${compactButton} ${css.toolbarEnd}`}
      aria-expanded={configOpen}
      aria-controls={CONFIG_PANEL_ID}
      onClick={onToggleConfig}
    >
      {configOpen ? t('config.collapse') : t('config.open')}
    </button>
  )

  /* 只读账号状态:主视图复制一份展示(与配置视图的 API Key 区同源,不含任何写操作入口) */
  const accountStatus = (
    <span className={css.statusLine}>
      <span className={css.tag} data-tone={data.configured ? 'success' : 'outline'}>
        {data.configured ? t('status.configured') : t('status.notConfigured')}
      </span>
      {data.configured && data.username ? (
        <span className={`${css.muted} ${css.statusText}`}>
          {t('status.loginSuccess')}{t('status.account')}:{data.username}
        </span>
      ) : null}
    </span>
  )

  /* 凭证输入框的本地格式校验:类型由前缀识别, 不通过时不发请求 */
  const detection = detectCredentialType(apiKeyInput)
  const inputError = apiKeyInput.trim() === '' || detection.ok
    ? undefined
    : detection.reason === 'client_secret'
      ? t('credential.errClientSecret')
      : t('credential.errUnknownFormat')

  /* 凭证管理属于配置:添加(自动识别类型) + 当前凭证信息 + 清除全部 */
  const credentialSection = (
    <section id={CONFIG_PANEL_ID} className={css.section}>
      <div className={css.sectionHead}>
        <h3 className={css.sectionTitle}>{t('credential.title')}</h3>
        <div className={css.actions}>
          <span className={css.tag} data-tone={data.configured ? 'success' : 'outline'}>
            {data.configured ? t('status.configured') : t('status.notConfigured')}
          </span>
          <span className={css.muted}>{t('credential.count')}: {data.count}</span>
          {data.count > 0 ? (
            <button
              type="button"
              className={clearConfirm
                ? `${css.button} ${css.buttonSm} ${css.buttonDanger}`
                : compactButton}
              onClick={onClearCredentials}
            >
              {clearConfirm ? t('credential.clearConfirm') : t('credential.clear')}
            </button>
          ) : null}
          <button type="button" className={compactButton} onClick={onRefresh}>
            {t('action.refresh')}
          </button>
        </div>
      </div>
      {data.configured ? (
        <p className={css.ok} role="status">
          {t('credential.activeType')}
          {': '}
          {data.activeType === 'oauth' ? t('credential.typeOauth') : t('credential.typeApiKey')}
          {data.activeMaskedSecret === undefined ? '' : ' ' + data.activeMaskedSecret}
          {data.username === undefined ? '' : ' · ' + t('status.account') + ':' + data.username}
          {data.fromEnv ? ' · ' + t('credential.fromEnv') : ''}
        </p>
      ) : null}
      <div className={css.field}>
        <span className={css.fieldLabel}>{t('credential.add')}</span>
        <div className={css.apiKeyRow}>
          <input
            className={css.input}
            type="password"
            autoComplete="off"
            placeholder={t('credential.placeholder')}
            value={apiKeyInput}
            onChange={(event) => { onApiKeyInput(event.target.value) }}
          />
          <button
            type="button"
            className={`${css.button} ${css.buttonPrimary}`}
            disabled={keySaving || !detection.ok}
            onClick={onSaveCredential}
          >
            {keySaving ? t('config.saving') : t('credential.save')}
          </button>
        </div>
        {inputError === undefined ? null : <p className={css.invalid}>{inputError}</p>}
        <span className={css.muted}>{t('credential.hintApiKey')}</span>
        <span className={css.muted}>{t('credential.hintOauth')}</span>
        <span className={css.muted}>{t('credential.overwrite')}</span>
      </div>
    </section>
  )

  /* 配置视图:直接切换 tab 内容(不另起浮层) */
  if (configOpen) {
    return (
      <>
        <div className={css.toolbar}>{toggleButton}</div>
        {credentialSection}
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('config.title')}</h3>
          <ToggleField
            label={t('config.enabled')}
            checked={draft.enabled}
            onChange={(value) => { onPatch('enabled', value) }}
          />
          <ToggleField
            label={t('config.reportEnabled')}
            checked={draft.reportEnabled}
            onChange={(value) => { onPatch('reportEnabled', value) }}
          />
          <NumberField
            label={t('config.reportInterval')}
            value={draft.reportInterval}
            onChange={(value) => { onDraft('reportInterval', value) }}
            onCommit={(value) => { onPatch('reportInterval', value) }}
          />
          <ToggleField
            label={t('config.includeTokens')}
            checked={draft.includeTokens}
            onChange={(value) => { onPatch('includeTokens', value) }}
          />
          <ToggleField
            label={t('config.includePrompts')}
            checked={draft.includePrompts}
            onChange={(value) => { onPatch('includePrompts', value) }}
          />
          <ToggleField
            label={t('config.debug')}
            checked={draft.debug}
            onChange={(value) => { onPatch('debug', value) }}
          />
          <ToggleField
            label={t('config.tableBorders')}
            checked={draft.tableBorders}
            onChange={(value) => { onPatch('tableBorders', value) }}
          />
          <SegmentedField
            label={t('config.statsScope')}
            value={draft.statsScope}
            options={[
              { value: 'all', label: t('config.statsScopeAll') },
              { value: 'current', label: t('config.statsScopeCurrent') },
            ]}
            onChange={(value) => { onPatch('statsScope', value === 'current' ? 'current' : 'all') }}
          />
          <SegmentedField
            label={t('config.digitGrouping')}
            value={draft.digitGrouping}
            options={[
              { value: 'thousand', label: t('config.digitGroupingThousand') },
              { value: 'myriad', label: t('config.digitGroupingMyriad') },
            ]}
            onChange={(value) => { onPatch('digitGrouping', value === 'myriad' ? 'myriad' : 'thousand') }}
          />
          <p className={css.muted}>{t('config.instantHint')}</p>
        </section>

        <section className={css.section}>
          <details className={css.details} open={bucketsOpen} onToggle={(event) => { onBucketsToggle(event.currentTarget.open) }}>
            <summary className={css.detailsRow}>
              <Chevron className={css.chevron} />
              <span className={css.disclosureTitle}>{t('buckets.title')}</span>
              <span className={css.muted}>{t('buckets.hint')}</span>
            </summary>
            <div className={css.disclosureBody}>
              {buckets === null
                ? <p className={css.muted}>{t('state.loading')}</p>
                : buckets.length === 0
                  ? <p className={css.muted}>{t('buckets.empty')}</p>
                  : buckets.map((entry) => (
                    <div key={entry.key} className={css.bucket}>
                      <div className={css.bucketHead}>
                        <code className={css.bucketKey}>{entry.maskedKey}</code>
                        {entry.credentialType === undefined ? null : (
                          <span className={css.tag} data-tone="outline">
                            {entry.credentialType === 'oauth' ? t('credential.typeOauth') : t('credential.typeApiKey')}
                          </span>
                        )}
                        <span className={css.tag} data-tone={entry.active ? 'success' : 'outline'}>
                          {entry.active ? t('credential.current') : (entry.removable ? t('buckets.stale') : t('buckets.recent'))}
                        </span>
                        <span className={css.muted}>{t('buckets.updatedAt')}: {formatTime(entry.updatedAt)}</span>
                        {!entry.active && entry.credentialType !== undefined ? (
                          <button
                            type="button"
                            className={compactButton}
                            onClick={() => { onSwitchCredential(entry.key) }}
                          >
                            {t('credential.switch')}
                          </button>
                        ) : null}
                        {!entry.active && entry.credentialType !== undefined ? (
                          <button
                            type="button"
                            className={credentialConfirm === entry.key
                              ? `${css.button} ${css.buttonSm} ${css.buttonDanger}`
                              : compactButton}
                            onClick={() => { onRemoveCredential(entry.key) }}
                          >
                            {credentialConfirm === entry.key ? t('credential.removeConfirm') : t('credential.remove')}
                          </button>
                        ) : null}
                        {entry.credentialType === undefined && entry.removable ? (
                          <button
                            type="button"
                            className={bucketConfirm === entry.key
                              ? `${css.button} ${css.buttonSm} ${css.buttonDanger}`
                              : compactButton}
                            onClick={() => { onRemoveBucket(entry.key) }}
                          >
                            {bucketConfirm === entry.key ? t('buckets.removeConfirm') : t('buckets.remove')}
                          </button>
                        ) : null}
                      </div>
                      <table className={`${css.table} ${css.statsTable}`} data-bordered={bordered}>
                        <colgroup>
                          <col />
                          <col />
                          <col />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>{t('stats.colMetric')}</th>
                            <th>{t('stats.colValue')}</th>
                            <th>{t('stats.colNote')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <MetricRows t={t} view={entry.stats} groupSize={groupSize} />
                        </tbody>
                      </table>
                    </div>
                  ))}
            </div>
          </details>
        </section>
      </>
    )
  }

  return (
    <>
      <div className={css.toolbar}>{accountStatus}{toggleButton}</div>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <h3 className={css.sectionTitle}>{t('stats.title')}</h3>
          <div className={css.actions}>
            <span className={css.muted}>
              {t('stats.scope')}: {view.scope === 'current' ? t('stats.scopeCurrent') : t('stats.scopeAll')}
              {' · '}{cloudMeta}{' · '}{t('cloud.range')}
            </span>
            <button
              type="button"
              className={compactButton}
              disabled={cloudState === 'syncing'}
              onClick={onSync}
            >
              {cloudState === 'syncing' ? t('cloud.syncing') : t('cloud.sync')}
            </button>
          </div>
        </div>
        <table className={`${css.table} ${css.statsTable}`} data-bordered={bordered}>
          <colgroup>
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>{t('stats.colMetric')}</th>
              <th>{t('stats.colValue')}</th>
              <th>{t('stats.colNote')}</th>
            </tr>
          </thead>
          <tbody>
            <MetricRows t={t} view={view} groupSize={groupSize} />
          </tbody>
        </table>
      </section>

      <section className={css.section}>
        <div className={css.disclosure}>
          <button
            type="button"
            className={css.disclosureRow}
            aria-expanded={logsOpen}
            aria-label={logsOpen ? t('logs.collapse') : t('logs.expand')}
            onClick={onToggleLogs}
          >
            <Chevron className={css.chevron} />
            <span className={css.disclosureTitle}>{t('logs.title')}</span>
          </button>
          {logsOpen ? (
            <div className={css.disclosureBody}>
              {logs.length === 0
                ? <p className={css.muted}>{t('logs.empty')}</p>
                : (
                  <table className={`${css.table} ${css.logsTable}`} data-bordered={bordered}>
                    <colgroup>
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>{t('logs.time')}</th>
                        <th>{t('logs.records')}</th>
                        <th>{t('logs.result')}</th>
                        <th>{t('logs.detail')}</th>
                        <th>{t('logs.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 展示顺序:时间最近优先(引擎按追加顺序保存,由旧到新) */}
                      {[...logs].reverse().map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatTime(entry.time)}</td>
                          <td>{groupDigits(entry.count, groupSize)} {t('logs.count')}</td>
                          <td className={entry.ok ? css.ok : css.error}>{logStateText(entry)}</td>
                          <td className={css.muted} data-column="detail">{logDetail(entry)}</td>
                          <td data-column="action">
                            {entry.state === 'failed' && entry.taskId !== undefined ? (
                              <button
                                type="button"
                                className={compactButton}
                                onClick={() => { onRetry(entry.taskId as string) }}
                              >
                                {t('logs.retry')}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          ) : null}
        </div>
      </section>

    </>
  )
}

/* 战绩指标行:主战绩表与各 Key 缓存明细表共用同一口径与格式化(见 src/metrics.ts);
   数位分隔符由配置项决定(千位 3 位一组 / 万位 4 位一组),数值列与备注一起生效 */
function MetricRows({ t, view, groupSize }: {
  t: PanelsProps['t']
  view: WebStatusResponse['stats']
  groupSize: number
}) {
  const aggregate = view.aggregate
  /* 平均输出速度:输出 TOKEN 总量 ÷ 思考总时长(秒)后向下取整 */
  const avgOutputSpeed = averageOutputSpeed(aggregate.outputTokens, aggregate.thinkingMs)
  return (
    <>
      <tr>
        <td data-column="metric">{t('stats.promptChars')}</td>
        <td data-column="value">{groupDigits(aggregate.promptChars, groupSize)}</td>
        <td data-column="note">{t('stats.promptEstimate').replace('{n}', groupDigits(aggregate.promptTokens, groupSize))}</td>
      </tr>
      <tr>
        <td data-column="metric">{t('stats.thinking')}</td>
        <td data-column="value">{formatThinkingDuration(aggregate.thinkingMs)}</td>
        <td data-column="note">{t('stats.noteThinking')}</td>
      </tr>
      <tr>
        <td data-column="metric">{t('stats.outputTokens')}</td>
        <td data-column="value">{groupDigits(aggregate.outputTokens, groupSize)}</td>
        <td data-column="note">{t('stats.noteOutput')}</td>
      </tr>
      <tr>
        <td data-column="metric">{t('stats.apiEffective')}</td>
        <td data-column="value">{groupDigits(effectiveTokens(aggregate), groupSize)}</td>
        <td data-column="note">{t('stats.noteApiEffective')}</td>
      </tr>
      <tr>
        <td data-column="metric">{t('stats.cacheHitTokens')}</td>
        <td data-column="value">{groupDigits(aggregate.cacheReadTokens, groupSize)}</td>
        <td data-column="note">{t('stats.noteCacheHitTokens')}</td>
      </tr>
      <tr>
        <td data-column="metric">{t('stats.avgOutputSpeed')}</td>
        <td data-column="value">{`${groupDigits(avgOutputSpeed, groupSize)} token/s`}</td>
        <td data-column="note">{t('stats.noteAvgOutputSpeed')}</td>
      </tr>
    </>
  )
}

/* 开关行:标签文本与官方 Switch 形态的按钮(aria-checked 驱动开态) */
function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className={css.field}>
      <div className={css.row}>
        <span className={css.fieldLabel}>{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          className={css.switch}
          onClick={() => { onChange(!checked) }}
        >
          <span className={css.thumb} />
        </button>
      </div>
    </div>
  )
}

/* 数字输入行:标签文本与官方形态输入框;
   输入过程只回传草稿值,失焦或回车才回传提交值(避免中间值即时生效) */
function NumberField({ label, value, onChange, onCommit }: {
  label: string
  value: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
}) {
  return (
    <div className={css.field}>
      <div className={css.row}>
        <span className={css.fieldLabel}>{label}</span>
        <input
          className={`${css.input} ${css.inputNarrow}`}
          type="number"
          min={1}
          aria-label={label}
          value={Number.isFinite(value) ? value : ''}
          onChange={(event) => { onChange(Number(event.target.value)) }}
          onBlur={(event) => { onCommit(Number(event.target.value)) }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            onCommit(Number(event.currentTarget.value))
          }}
        />
      </div>
    </div>
  )
}

/* 折叠指示图标:官方 DisclosureRow 的 16px 盒内 14px 折角(描边用 currentColor) */
function Chevron({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 6.5 8 10.5 12 6.5"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function fromConfig(config: WebStatusResponse['config']): ConfigDraft {
  return {
    enabled: config.enabled,
    reportInterval: config.reportInterval,
    reportEnabled: config.reportEnabled,
    includeTokens: config.includeTokens,
    includePrompts: config.includePrompts,
    debug: config.debug,
    tableBorders: config.tableBorders,
    statsScope: config.statsScope,
    digitGrouping: config.digitGrouping,
  }
}

/* 档位切换条:滑块式二选一控件(radiogroup 语义,选中档由滑块指示,支持键盘聚焦与空格切换) */
function SegmentedField({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly { value: string, label: string }[]
  onChange: (value: string) => void
}) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value))
  return (
    <div className={css.field}>
      <div className={css.row}>
        <span className={css.fieldLabel}>{label}</span>
        <div
          className={css.segmented}
          role="radiogroup"
          aria-label={label}
          style={{ '--segment-count': options.length, '--segment-index': activeIndex } as CSSProperties}
        >
          <span className={css.segmentKnob} aria-hidden="true" />
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === value}
              className={css.segment}
              data-active={option.value === value}
              onClick={() => { onChange(option.value) }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* 日期格式:yyyy-MM-dd HH:mm:ss+HH:mm(本地时区) */
function formatTime(millis: number): string {
  const date = new Date(millis)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
