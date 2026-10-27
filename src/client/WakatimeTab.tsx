/*
 * WakaTime 会话区域标签页组件
 * 作者: JularDepick
 *
 * Agent 协作战绩(全局):提示词字符总量(官方 ai_prompt_length 口径)、
 * 模型思考总时长、输出 TOKEN 总量、有效 TOKEN 消耗量(官方计费口径)、
 * 平均输出速度(输出 TOKEN ÷ 思考秒数,向下取整)等;
 * 单份 OAuth 凭证管理(小后端代理,仅覆盖不可查看;更换凭证后本地战绩保留);
 * 上报记录日志(可展开/收起,调试级);主视图工具条左侧带只读账号状态,
 * 凭证变更与上报参数同属配置,由右上角按钮切换出的配置视图承载(ESC 切回主视图)。
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
import {
  DIGIT_GROUP_SIZES,
  WEB_CONFIG_PATH,
  WEB_CREDENTIAL_CLEAR_PATH,
  WEB_CREDENTIAL_PATH,
  WEB_LOGS_PATH,
  WEB_RETRY_PATH,
  WEB_STATUS_PATH,
  WEB_SYNC_PATH,
} from '../constants'
import type { DigitGrouping } from '../config'
import { averageOutputSpeed, effectiveTokens, formatThinkingDuration, groupDigits } from '../metrics'
import type { WebCredentialClearResponse, WebCredentialResponse, WebLogEntry, WebStatusResponse, WebSyncResponse } from '../webui/types'
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
  /* 数位分隔符:千位(3 位一组)/ 万位(4 位一组),纯展示项 */
  digitGrouping: DigitGrouping
}

/** 保存结果提示 */
interface Notice {
  kind: 'ok' | 'error'
  text: string
}

/* 路由与宿主共用同一份常量,避免两侧各自维护字符串导致漂移 */
const STATUS_PATH = WEB_STATUS_PATH
const CONFIG_PATH = WEB_CONFIG_PATH
const CREDENTIAL_PATH = WEB_CREDENTIAL_PATH
const CREDENTIAL_CLEAR_PATH = WEB_CREDENTIAL_CLEAR_PATH
const LOGS_PATH = WEB_LOGS_PATH
const SYNC_PATH = WEB_SYNC_PATH
const RETRY_PATH = WEB_RETRY_PATH

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
  /* 输入框内容(只接受 OAuth 访问令牌) */
  const [credentialInput, setCredentialInput] = useState('')
  const [logs, setLogs] = useState<readonly WebLogEntry[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [keySaving, setKeySaving] = useState(false)
  const [tick, setTick] = useState(0)
  /* 刷新请求序号: 只采用最后一次请求的结果, 避免旧响应覆盖新状态 */
  const reloadSeq = useRef(0)
  /* 正在提交的配置键: 提交未落定前不用服务端值覆盖草稿, 否则正在编辑的数字会被重置 */
  const pendingPatch = useRef<keyof ConfigDraft | undefined>(undefined)
  /* 云端同步状态(战绩数值与云端快照由服务端按数据桶解析后下发) */
  const [cloudState, setCloudState] = useState<'idle' | 'syncing' | 'error'>('idle')
  /* 同步失败原因(区分未配置凭证与网络失败),失败时展示在战绩标题行 */
  const [syncError, setSyncError] = useState<string | undefined>(undefined)
  /* 正在重试的失败任务标识:在途期间禁用其它重试按钮,避免重复提交 */
  const [retryingId, setRetryingId] = useState<string | undefined>(undefined)
  /* 清除 API Key 二次确认(3 秒内点击确认,超时回归) */
  const [clearConfirm, setClearConfirm] = useState(false)
  /* 配置视图开关(右上角按钮切换 tab 内容,ESC 切回主视图) */
  const [configOpen, setConfigOpen] = useState(false)
  const configToggleRef = useRef<HTMLButtonElement | null>(null)

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

  /* 清除已保存凭证(回退未配置;本地战绩保留)并刷新状态 */
  const clearCredentials = (): void => {
    if (!clearConfirm) {
      setClearConfirm(true)
      return
    }
    setClearConfirm(false)
    fetch(CREDENTIAL_CLEAR_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as WebCredentialClearResponse
        if (!response.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${response.status}`)
        clearSynced()
        setCloudState('idle')
        setNotice({ kind: 'ok', text: t('credential.cleared') })
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => {
        const code = error instanceof Error ? error.message : ''
        setNotice({
          kind: 'error',
          text: code === 'env_locked' ? t('credential.errEnvLocked') : t('credential.clearFailed'),
        })
      })
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
          setSyncError(undefined)
        } else {
          setCloudState('error')
          setSyncError(result.error === 'credential not configured' ? t('cloud.errNoCredential') : t('cloud.errFailed'))
        }
      })
      .catch(() => {
        setCloudState('error')
        setSyncError(t('cloud.errFailed'))
      })
  }

  /* 上报记录:失败行手动重试(移回推送队列并立即尝试一轮) */
  const retryLog = (id: string): void => {
    if (retryingId !== undefined) return
    setRetryingId(id)
    fetch(RETRY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((response) => {
        if (response.status === 404) {
          setNotice({ kind: 'error', text: t('logs.retryUnavailable') })
          return
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: (error as Error).message }) })
      .finally(() => { setRetryingId(undefined) })
  }

  /* 凭证操作错误码直接映射为字典文案 */
  const credentialErrorText = (code: string | undefined): string => {
    if (code === 'empty') return t('credential.errEmpty')
    if (code === 'client_secret') return t('credential.errClientSecret')
    if (code === 'api_key') return t('credential.errApiKey')
    if (code === 'unknown_format') return t('credential.errUnknownFormat')
    if (code === 'env_locked') return t('credential.errEnvLocked')
    /* 未知错误码不再直显服务端英文原文 */
    return t('credential.errInvalid')
  }

  /* 拉取状态与上报日志;已配置且本地无云端缓存时才同步 */
  const reload = (): void => {
    const seq = reloadSeq.current + 1
    reloadSeq.current = seq
    setLoadError(undefined)
    fetch(STATUS_PATH, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<WebStatusResponse>
      })
      .then((next) => {
        if (seq !== reloadSeq.current) return
        setData(next)
        /* 有未落定的配置提交时保留草稿, 服务端值在提交成功后随下一次刷新落地 */
        if (pendingPatch.current === undefined) setDraft(fromConfig(next.config))
        if (next.configured && !syncedRecently()) syncCloud()
      })
      .catch((error: unknown) => {
        if (seq !== reloadSeq.current) return
        setLoadError((error as Error).message)
        /* 已有数据时刷新失败也要让用户看见, 否则会以为界面是最新的 */
        if (data !== null) setNotice({ kind: 'error', text: t('state.loadFailed') })
      })
    fetch(LOGS_PATH, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        /* 后端异常时回的是 { ok:false } 对象: 非数组一律不替换, 避免渲染层崩溃 */
        return Array.isArray(body) ? body as readonly WebLogEntry[] : null
      })
      .then((next) => { if (next !== null) setLogs(next) })
      .catch(() => { /* 保留上一次拿到的记录 */ })
  }

  useEffect(() => { reload() }, [tick])

  /* 上报记录失败原因: 已知类别映射为字典文案, 其余(如底层网络错误)原样展示便于排查 */
  const describeLogError = (error: string | undefined): string => {
    if (error === undefined || error === '') return ''
    if (/credential|401|403|Unauthorized|Forbidden/i.test(error)) return t('logs.errCredential')
    if (/network|timeout|ENOTFOUND|ECONN|fetch failed|5\d\d/i.test(error)) return t('logs.errNetwork')
    if (/^HTTP \d{3}$/.test(error)) return t('logs.errNetwork')
    return error
  }

  /* 提示停留后自动消失(与官方 Toast 的 3000ms 停留 + 1000ms 淡出一致) */
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => { setNotice(undefined) }, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const patch = (key: keyof ConfigDraft, value: ConfigDraft[keyof ConfigDraft]): void => {
    /* 与"服务端已生效的值"比较: 数字字段先在草稿改值再提交, 拿草稿比较会把提交全部短路掉 */
    if (data !== null && (data.config as ConfigDraft)[key] === value) return
    pendingPatch.current = key
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
        /* 服务端已按新配置重算战绩与展示项, 刷新状态使主视图同步 */
        pendingPatch.current = undefined
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => {
        setNotice({ kind: 'error', text: `${t('config.saveFailed')}: ${(error as Error).message}` })
        /* 写入失败:重新拉取状态,使草稿回到服务端已生效的值 */
        pendingPatch.current = undefined
        setTick((value) => value + 1)
      })
  }

  /* 数字字段输入过程只更新草稿,避免中间值(如 1)即时生效 */
  const draftOnly = (key: keyof ConfigDraft, value: ConfigDraft[keyof ConfigDraft]): void => {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
  }

  /* 凭证保存或更换:前端先按前缀校验格式, 小后端再权威校验并验证有效性;
     成功后清空输入框、提示已保存并刷新状态(本地战绩不受影响) */
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
      .then((result) => {
        setCredentialInput('')
        setNotice({ kind: 'ok', text: result.replaced ? t('credential.replaced') : t('credential.added') })
        /* 换了账号:同步节流与错误态重置,下次按新令牌重新同步 */
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
              {t('state.loadFailed')}: {loadError}
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
              syncError={syncError}
              retryingId={retryingId}
              credentialInput={credentialInput}
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
              onClearCredentials={clearCredentials}
              onCredentialInput={setCredentialInput}
              onSaveCredential={saveCredential}
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
  syncError?: string
  retryingId?: string
  credentialInput: string
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
  onClearCredentials: () => void
  onCredentialInput: (value: string) => void
  onSaveCredential: () => void
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
  const { t, data, draft, logs, logsOpen, cloudState, syncError } = props
  const { credentialInput: credentialValue, keySaving, clearConfirm } = props
  const { configOpen, configToggleRef } = props
  const { describeLogError, onToggleLogs, onRefresh, onSync, onRetry, onClearCredentials, onToggleConfig } = props
  const { onCredentialInput, onSaveCredential, onPatch, onDraft } = props
  /* 战绩视图由服务端解析:本地累计量已与云端快照逐项取最大 */
  const view = data.stats  /* 表格边框:配置项驱动(默认开启),关闭时退回仅横向分隔线的观感 */
  const bordered = draft.tableBorders ? 'true' : 'false'
  /* 数值展示的每组位数:千位 3 位、万位 4 位(两者都用英文逗号分隔) */
  const groupSize = DIGIT_GROUP_SIZES[draft.digitGrouping]
  const syncFailure = cloudState === 'error' ? (syncError ?? t('cloud.failed')) : ''
  const cloudMeta = view.cloud
    ? `${t('cloud.syncedAt')}: ${formatTime(view.cloud.syncedAt)}${syncFailure === '' ? '' : ` · ${syncFailure}`}`
    : (syncFailure === '' ? t('cloud.never') : syncFailure)

  /* 上报记录结果文案:成功 / 失败 / 已重试(重试行不关心重试结果) */
  const logStateText = (entry: WebLogEntry): string => {
    if (entry.ok) return t('logs.success')
    return entry.state === 'retried' ? t('logs.retried') : t('logs.failed')
  }

  /* 上报记录详情:失败原因(稳定标识映射)与本次上报内容摘要(类别计数与项目/分支);
     旧版记录没有摘要时回退为心跳对象 */
  const logDetail = (entry: WebLogEntry): string => {
    const reason = describeLogError(entry.error)
    const base = entry.detail ?? entry.entity ?? ''
    const attempts = entry.attempts === undefined
      ? ''
      : t('logs.attempts').replace('{n}', String(entry.attempts))
    const content = base === '' ? attempts : (attempts === '' ? base : `${base} · ${attempts}`)
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
          {t('status.loggedInAs').replace('{name}', data.username)}
        </span>
      ) : null}
    </span>
  )

  /* 凭证输入框的本地格式校验:只接受 OAuth 令牌, 不通过时不发请求 */
  const detection = detectCredentialType(credentialValue)
  const inputError = credentialValue.trim() === '' || detection.ok
    ? undefined
    : detection.reason === 'client_secret'
      ? t('credential.errClientSecret')
      : detection.reason === 'api_key'
        ? t('credential.errApiKey')
        : t('credential.errUnknownFormat')

  /* 凭证管理属于配置:当前凭证信息(打码值/账号/更新时间) + 保存或更换 + 清除 */
  const credentialSection = (
    <section id={CONFIG_PANEL_ID} className={css.section}>
      <div className={css.sectionHead}>
        <h3 className={css.sectionTitle}>{t('credential.title')}</h3>
        <div className={css.actions}>
          <span className={css.tag} data-tone={data.configured ? 'success' : 'outline'}>
            {data.configured ? t('status.configured') : t('status.notConfigured')}
          </span>
          {data.configured && !data.fromEnv ? (
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
        <>
          {data.maskedSecret === undefined ? null : (
            <p className={css.ok} role="status">
              {data.maskedSecret}
              {data.fromEnv ? ' · ' + t('credential.fromEnv') : ''}
            </p>
          )}
          <p className={css.muted}>
            {t('status.account')}
            {': '}
            {data.username ?? t('credential.accountUnknown')}
          </p>
          {data.credentialUpdatedAt === undefined ? null : (
            <p className={css.muted}>
              {t('credential.updatedAt')}
              {': '}
              {formatTime(data.credentialUpdatedAt)}
            </p>
          )}
        </>
      ) : null}
      <div className={css.field}>
        <span className={css.fieldLabel}>{t('credential.add')}</span>
        <div className={css.credentialRow}>
          <input
            className={css.input}
            type="password"
            autoComplete="off"
            aria-label={t('credential.add')}
            placeholder={t('credential.placeholder')}
            value={credentialValue}
            onChange={(event) => { onCredentialInput(event.target.value) }}
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
        {inputError === undefined ? null : <p className={css.error}>{inputError}</p>}
        <span className={css.muted}>{t('credential.hintOauth')}</span>
        <span className={css.muted}>{t('credential.hintOauthScopes')}</span>
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
          <div className={css.sectionHead}>
            <h3 className={css.sectionTitle}>{t('config.title')}</h3>
            <span className={css.muted}>{t('config.instantHint')}</span>
          </div>
          <div className={css.configGrid}>
            <div className={css.configGroup}>
              <span className={css.groupTitle}>{t('config.groupReporting')}</span>
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
            </div>
            <div className={css.configGroup}>
              <span className={css.groupTitle}>{t('config.groupPayload')}</span>
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
            </div>
            <div className={css.configGroup}>
              <span className={css.groupTitle}>{t('config.groupDisplay')}</span>
              <SegmentedField
                label={t('config.digitGrouping')}
                value={draft.digitGrouping}
                options={[
                  { value: 'thousand', label: t('config.digitGroupingThousand') },
                  { value: 'myriad', label: t('config.digitGroupingMyriad') },
                ]}
                onChange={(value) => { onPatch('digitGrouping', value === 'myriad' ? 'myriad' : 'thousand') }}
              />
              <ToggleField
                label={t('config.tableBorders')}
                checked={draft.tableBorders}
                onChange={(value) => { onPatch('tableBorders', value) }}
              />
            </div>
            <div className={css.configGroup}>
              <span className={css.groupTitle}>{t('config.groupDiagnostics')}</span>
              <ToggleField
                label={t('config.debug')}
                checked={draft.debug}
                onChange={(value) => { onPatch('debug', value) }}
              />
            </div>
          </div>
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
              {cloudMeta}{' · '}{t('cloud.range')}
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
        <table className={`${css.table} ${css.statsTable}`} data-bordered={bordered} aria-label={t('stats.title')}>
          <colgroup>
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t('stats.colMetric')}</th>
              <th scope="col">{t('stats.colValue')}</th>
              <th scope="col">{t('stats.colNote')}</th>
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
                  <table className={`${css.table} ${css.logsTable}`} data-bordered={bordered} aria-label={t('logs.title')}>
                    <colgroup>
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">{t('logs.time')}</th>
                        <th scope="col">{t('logs.records')}</th>
                        <th scope="col">{t('logs.result')}</th>
                        <th scope="col">{t('logs.detail')}</th>
                        <th scope="col">{t('logs.action')}</th>
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
                            {entry.state === 'failed' && entry.taskId !== undefined && entry.retryable !== false ? (
                              <button
                                type="button"
                                className={compactButton}
                                disabled={props.retryingId !== undefined}
                                onClick={() => { onRetry(entry.taskId as string) }}
                              >
                                {props.retryingId === entry.taskId ? t('logs.retrying') : t('logs.retry')}
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

/* 战绩指标行:指标口径与格式化统一来自 src/metrics.ts;
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
        <td data-column="value">{t('stats.tokenPerSecond').replace('{n}', groupDigits(avgOutputSpeed, groupSize))}</td>
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
          onChange={(event) => {
            const next = Number(event.target.value)
            if (event.target.value === '' || !Number.isFinite(next)) return
            onChange(next)
          }}
          onBlur={(event) => {
            const raw = event.target.value
            const next = Number(raw)
            if (raw === '' || !Number.isFinite(next) || next < 1) return
            onCommit(next)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            const raw = event.currentTarget.value
            const next = Number(raw)
            if (raw === '' || !Number.isFinite(next) || next < 1) return
            onCommit(next)
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
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  return (
    <div className={css.field}>
      <div className={css.row}>
        <span className={css.fieldLabel}>{label}</span>
        <div
          className={css.segmented}
          role="radiogroup"
          aria-label={label}
          style={{ '--segment-count': options.length, '--segment-index': activeIndex } as CSSProperties}
          onKeyDown={(event) => {
            /* 方向键按档位移动选择:与原生 radio 组的键盘行为一致 */
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? 1
              : (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0)
            if (step === 0) return
            event.preventDefault()
            const nextIndex = (activeIndex + step + options.length) % options.length
            const next = options[nextIndex]
            if (next === undefined) return
            onChange(next.value)
            /* 选中项改变后 tabIndex 也变了: 焦点必须跟着移过去, 否则下一次 Tab 会跳过整组 */
            buttons.current[nextIndex]?.focus()
          }}
        >
          <span className={css.segmentKnob} aria-hidden="true" />
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              ref={(element) => { buttons.current[options.indexOf(option)] = element }}
              role="radio"
              aria-checked={option.value === value}
              tabIndex={option.value === value ? 0 : -1}
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
