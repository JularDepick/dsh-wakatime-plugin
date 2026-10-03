/*
 * WakaTime 会话区域标签页组件
 * 作者: JularDepick
 *
 * Agent 协作战绩(全局):提示词总量(字符,官方 ai_prompt_length 口径)、
 * LLM 思考总时长、输出 TOKEN、API 有效 TOKEN 消耗(输入+输出)等;
 * API Key 覆盖管理(小后端代理,仅覆盖不可查看);
 * 上报记录日志(可展开/收起,调试级);配置以独立视图形式由右上角按钮切换(ESC 切回)。
 * 数据经 host webserver 接口读写(仅 web profile 提供)。
 * 语言跟随 dsh web UI 语言切换(字典经 locale 座位注入)。
 * 版式:内容直接铺在 tab 下,不再自建卡片(分区之间用分隔线区分),
 * 战绩为独立表格;字设与配色继承 profile 的 --dsw-font-* 与 --dsw-alias-* 令牌。
 * 官方控件形态自行复制(官方守则禁止外部插件 value-import Harness Client 包)。
 */

import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WebConfigPayload, WebLogEntry, WebStatusResponse, WebSyncResponse } from '../webui/types'
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
}

/** 保存结果提示 */
interface Notice {
  kind: 'ok' | 'error'
  text: string
}

const STATUS_PATH = '/api/wakatime/status'
const CONFIG_PATH = '/api/wakatime/config'
const APIKEY_PATH = '/api/wakatime/apikey'
const LOGS_PATH = '/api/wakatime/logs'
const SYNC_PATH = '/api/wakatime/sync'
const APIKEY_CLEAR_PATH = '/api/wakatime/apikey/clear'

/** 清除确认与提示停留时长:与官方 Toast 默认一致(1000ms 淡出另计) */
const CONFIRM_MS = 3000
const NOTICE_MS = 3000

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
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [logs, setLogs] = useState<readonly WebLogEntry[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [saving, setSaving] = useState(false)
  const [keySaving, setKeySaving] = useState(false)
  const [tick, setTick] = useState(0)
  /* 云端同步(已配置 API Key 时拉取 summaries AI 聚合) */
  const [cloud, setCloud] = useState<WebSyncResponse['data'] | null>(null)
  const [cloudState, setCloudState] = useState<'idle' | 'syncing' | 'error'>('idle')
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

  /* 清除本地 API Key(回退未登录)并刷新状态 */
  const clearApiKey = (): void => {
    if (!clearConfirm) {
      setClearConfirm(true)
      return
    }
    setClearConfirm(false)
    fetch(APIKEY_CLEAR_PATH, { method: 'POST' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setCloud(null)
        setCloudState('idle')
        setTick((value) => value + 1)
      })
      .catch(() => { setNotice({ kind: 'error', text: t('state.loadFailed') }) })
  }

  /* 云端同步:已配置时向小后端拉取 summaries AI 聚合;失败仅置错误态 */
  const syncCloud = (): void => {
    setCloudState('syncing')
    fetch(SYNC_PATH, { cache: 'no-store' })
      .then((response) => response.json() as Promise<WebSyncResponse>)
      .then((result) => {
        if (result.ok && result.data) {
          setCloud(result.data)
          setCloudState('idle')
        } else {
          setCloudState('error')
        }
      })
      .catch(() => { setCloudState('error') })
  }

  /* 拉取状态与上报日志;已配置且有云数据需求时自动同步一次 */
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
        if (next.configured && cloud === null) syncCloud()
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
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
  }

  const save = (): void => {
    if (!draft) return
    setSaving(true)
    setNotice(undefined)
    fetch(CONFIG_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toPayload(draft)),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ ok: boolean }>
      })
      .then(() => { setNotice({ kind: 'ok', text: t('config.saved') }) })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: `${t('config.saveFailed')}: ${(error as Error).message}` }) })
      .finally(() => { setSaving(false) })
  }

  /* API Key 覆盖写入:小后端先验证,失败不保存并回报;成功后清空输入框,
     状态行经刷新展示「登录成功, 当前账号:xxx」(不弹成功飘窗) */
  const saveApiKey = (): void => {
    const key = apiKeyInput.trim()
    if (!key) return
    setKeySaving(true)
    setNotice(undefined)
    fetch(APIKEY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
    })
      .then(async (response) => {
        const result = await response.json() as { ok: boolean; username?: string | null; error?: string }
        if (!response.ok || !result.ok) {
          throw new Error(result.error ?? `HTTP ${response.status}`)
        }
        return result
      })
      .then(() => {
        setApiKeyInput('')
        setTick((value) => value + 1)
      })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: `${t('apikey.invalid')} (${(error as Error).message})` }) })
      .finally(() => { setKeySaving(false) })
  }

  return (
    <div className={css.tab}>
      <div className={css.column}>
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
            cloud={cloud}
            cloudState={cloudState}
            apiKeyInput={apiKeyInput}
            saving={saving}
            keySaving={keySaving}
            clearConfirm={clearConfirm}
            configOpen={configOpen}
            configToggleRef={configToggleRef}
            describeLogError={describeLogError}
            onToggleLogs={() => { setLogsOpen(!logsOpen) }}
            onToggleConfig={() => { setConfigOpen(!configOpen) }}
            onRefresh={() => { setTick((value) => value + 1) }}
            onSync={syncCloud}
            onClearApiKey={clearApiKey}
            onApiKeyInput={setApiKeyInput}
            onSaveApiKey={saveApiKey}
            onPatch={patch}
            onSave={save}
          />
        )}
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
  cloud: WebSyncResponse['data'] | null
  cloudState: 'idle' | 'syncing' | 'error'
  apiKeyInput: string
  saving: boolean
  keySaving: boolean
  clearConfirm: boolean
  configOpen: boolean
  configToggleRef: MutableRefObject<HTMLButtonElement | null>
  describeLogError: (error: string | undefined) => string
  onToggleLogs: () => void
  onToggleConfig: () => void
  onRefresh: () => void
  onSync: () => void
  onClearApiKey: () => void
  onApiKeyInput: (value: string) => void
  onSaveApiKey: () => void
  onPatch: (key: keyof ConfigDraft, value: ConfigDraft[keyof ConfigDraft]) => void
  onSave: () => void
}

/**
 * 渲染主视图(战绩 → API Key → 上报记录)或配置视图。
 * 战绩为独立表格;分区之间用分隔线区分,不自建卡片;
 * 右上角按钮在两个视图之间切换 tab 内容(ESC 切回主视图)。
 * @param props - 数据、草稿与回调集合。
 * @returns 当前视图内容。
 */
function WakatimePanels(props: PanelsProps) {
  const { t, data, draft, logs, logsOpen, cloud, cloudState } = props
  const { apiKeyInput, saving, keySaving, clearConfirm } = props
  const { configOpen, configToggleRef } = props
  const { describeLogError, onToggleLogs, onRefresh, onSync, onClearApiKey, onToggleConfig } = props
  const { onApiKeyInput, onSaveApiKey, onPatch, onSave } = props
  const aggregate = data.stats.aggregate
  const thinkingMinutes = Math.floor(aggregate.thinkingMs / 60000)
  const thinkingSeconds = Math.round((aggregate.thinkingMs % 60000) / 1000)
  /* 云端与本地合并:可对应指标取最大值,保证云端与本地一致性 */
  const cloudInput = cloud?.inputTokens ?? 0
  const cloudOutput = cloud?.outputTokens ?? 0
  const cloudPrompt = cloud?.promptChars ?? 0
  const mergedPromptChars = Math.max(aggregate.promptChars, cloudPrompt)
  const mergedOutputTokens = Math.max(aggregate.outputTokens, cloudOutput)
  const mergedApiEffective = Math.max(effectiveTokens(aggregate), cloudInput + cloudOutput)
  const cloudMeta = cloud
    ? `${t('cloud.syncedAt')}: ${formatTime(cloud.syncedAt)}`
    : (cloudState === 'error' ? t('cloud.failed') : t('cloud.never'))

  /* 右上角视图切换按钮:主视图与配置视图共用 */
  const toggleButton = (
    <div className={css.toolbar}>
      <button
        type="button"
        ref={configToggleRef}
        className={compactButton}
        aria-expanded={configOpen}
        aria-controls={CONFIG_PANEL_ID}
        onClick={onToggleConfig}
      >
        {configOpen ? t('config.collapse') : t('config.open')}
      </button>
    </div>
  )

  /* 配置视图:直接切换 tab 内容(不另起浮层) */
  if (configOpen) {
    return (
      <>
        {toggleButton}
        <section id={CONFIG_PANEL_ID} className={css.section}>
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
            onChange={(value) => { onPatch('reportInterval', value) }}
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
          <div className={css.saveRow}>
            <button
              type="button"
              className={`${css.button} ${css.buttonPrimary}`}
              disabled={saving}
              onClick={onSave}
            >
              {saving ? t('config.saving') : t('config.save')}
            </button>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      {toggleButton}

      <section className={css.section}>
        <div className={css.sectionHead}>
          <h3 className={css.sectionTitle}>{t('stats.title')}</h3>
          <div className={css.actions}>
            <span className={css.muted}>{cloudMeta}{' · '}{t('cloud.range')}</span>
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
        <table className={`${css.table} ${css.statsTable}`}>
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
            <tr>
              <td data-column="metric">{t('stats.promptChars')}</td>
              <td data-column="value">{mergedPromptChars.toLocaleString()}</td>
              <td data-column="note">{t('stats.promptEstimate').replace('{n}', aggregate.promptTokens.toLocaleString())}</td>
            </tr>
            <tr>
              <td data-column="metric">{t('stats.thinking')}</td>
              <td data-column="value">{`${thinkingMinutes}′${String(thinkingSeconds).padStart(2, '0')}″`}</td>
              <td data-column="note">{t('stats.noteThinking')}</td>
            </tr>
            <tr>
              <td data-column="metric">{t('stats.outputTokens')}</td>
              <td data-column="value">{mergedOutputTokens.toLocaleString()}</td>
              <td data-column="note">{t('stats.noteOutput')}</td>
            </tr>
            <tr>
              <td data-column="metric">{t('stats.apiEffective')}</td>
              <td data-column="value">{mergedApiEffective.toLocaleString()}</td>
              <td data-column="note">{t('stats.noteApiEffective')}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <h3 className={css.sectionTitle}>{t('apikey.title')}</h3>
          <div className={css.actions}>
            <span className={css.tag} data-tone={data.configured ? 'success' : 'outline'}>
              {data.configured ? t('status.configured') : t('status.notConfigured')}
            </span>
            {data.configured ? (
              <button
                type="button"
                className={clearConfirm
                  ? `${css.button} ${css.buttonSm} ${css.buttonDanger}`
                  : compactButton}
                onClick={onClearApiKey}
              >
                {clearConfirm ? t('apikey.clearConfirm') : t('apikey.clear')}
              </button>
            ) : null}
            <button type="button" className={compactButton} onClick={onRefresh}>
              {t('action.refresh')}
            </button>
          </div>
        </div>
        {data.configured && data.username ? (
          <p className={css.ok} role="status">
            {t('status.loginSuccess')}{t('status.account')}:{data.username}
          </p>
        ) : null}
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('apikey.save')}</span>
          <span className={css.muted}>{t('apikey.hint')}{t('apikey.overwrite')}</span>
          <div className={css.apiKeyRow}>
            <input
              className={css.input}
              type="password"
              autoComplete="off"
              placeholder={t('apikey.placeholder')}
              value={apiKeyInput}
              onChange={(event) => { onApiKeyInput(event.target.value) }}
            />
            <button
              type="button"
              className={`${css.button} ${css.buttonPrimary}`}
              disabled={keySaving || apiKeyInput.trim() === ''}
              onClick={onSaveApiKey}
            >
              {keySaving ? t('config.saving') : t('apikey.save')}
            </button>
          </div>
        </div>
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
                  <table className={`${css.table} ${css.logsTable}`}>
                    <colgroup>
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
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((entry, index) => (
                        <tr key={`${entry.time}-${index}`}>
                          <td>{formatTime(entry.time)}</td>
                          <td>{entry.count} {t('logs.count')}</td>
                          <td className={entry.ok ? css.ok : css.error}>{entry.ok ? t('logs.success') : t('logs.failed')}</td>
                          <td className={css.muted}>{describeLogError(entry.error)}</td>
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

/* 数字输入行:标签文本与官方形态输入框 */
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
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
  }
}

function toPayload(draft: ConfigDraft): WebConfigPayload {
  return {
    enabled: draft.enabled,
    reportInterval: draft.reportInterval,
    reportEnabled: draft.reportEnabled,
    includeTokens: draft.includeTokens,
    includePrompts: draft.includePrompts,
    debug: draft.debug,
  }
}

/* API 有效 TOKEN 消耗:输入 + 输出(官方 Heartbeat 仅 ai_input_tokens/ai_output_tokens,
   缓存命中 Token 无官方字段,不并入,仅本地明细可见) */
function effectiveTokens(stats: {
  inputTokens: number
  outputTokens: number
}): number {
  return stats.inputTokens + stats.outputTokens
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
