/*
 * WakaTime 会话区域标签页组件
 * 作者: JularDepick
 *
 * Agent 协作战绩(全局):提示词总量(字符,官方 ai_prompt_length 口径)、
 * LLM 思考总时长、输出 TOKEN、API 有效 TOKEN 消耗(输入+输出)等;
 * API Key 覆盖管理(小后端代理,仅覆盖不可查看);
 * 上报记录日志(可展开/收起,调试级);配置区。
 * 数据经 host webserver 接口读写(仅 web profile 提供)。
 * 语言跟随 dsh web UI 语言切换(字典经 locale 座位注入)。
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WebConfigPayload, WebLogEntry, WebStatusResponse } from '../webui/types'
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

/**
 * 渲染 wakatime 标签页。
 * @param props - 框架座位:t 为 locale 座位,会话座位不消费。
 * @returns 战绩面板、API Key 覆盖区、上报日志与配置区。
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

  /* 拉取状态与上报日志 */
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
      })
      .catch((error: unknown) => { setLoadError((error as Error).message) })
    fetch(LOGS_PATH, { cache: 'no-store' })
      .then((response) => response.json() as Promise<readonly WebLogEntry[]>)
      .then(setLogs)
      .catch(() => { setLogs([]) })
  }

  useEffect(() => { reload() }, [tick])

  /* 提示 3 秒后自动消失 */
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => { setNotice(undefined) }, 3000)
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

  if (loadError !== undefined && data === null) {
    return (
      <div className={css.tab}>
        <p className={css.error} role="status">
          {t('state.loadFailed')}:{loadError}
        </p>
      </div>
    )
  }
  if (data === null || draft === null) {
    return (
      <div className={css.tab}>
        <p className={css.muted}>{t('state.loading')}</p>
      </div>
    )
  }

  const aggregate = data.stats.aggregate
  const thinkingMinutes = Math.floor(aggregate.thinkingMs / 60000)
  const thinkingSeconds = Math.round((aggregate.thinkingMs % 60000) / 1000)

  return (
    <div className={css.tab}>
      <section className={css.card}>
        <div className={css.cardHead}>
          <h3 className={css.cardTitle}>
            {data.configured ? t('status.configured') : t('status.notConfigured')}
          </h3>
          <button type="button" className={css.refresh} onClick={() => { setTick((value) => value + 1) }}>
            {t('action.refresh')}
          </button>
        </div>
        {data.configured && data.username ? (
          <p className={css.ok} role="status">
            {t('status.loginSuccess')}{t('status.account')}:{data.username}
          </p>
        ) : null}
        <p className={css.muted}>{t('apikey.hint')}</p>
        <div className={css.apiKeyRow}>
          <input
            className={css.input}
            type="password"
            autoComplete="off"
            placeholder={t('apikey.placeholder')}
            value={apiKeyInput}
            onChange={(event) => { setApiKeyInput(event.target.value) }}
          />
          <button type="button" className={css.save} disabled={keySaving || apiKeyInput.trim() === ''} onClick={saveApiKey}>
            {keySaving ? t('config.saving') : t('apikey.save')}
          </button>
        </div>
        <p className={css.muted}>{t('apikey.overwrite')}</p>
      </section>

      <section className={css.card}>
        <h3 className={css.cardTitle}>{t('stats.title')}</h3>
        <div className={css.grid}>
          <Stat
            label={t('stats.promptChars')}
            value={aggregate.promptChars.toLocaleString()}
            sub={t('stats.promptEstimate').replace('{n}', aggregate.promptTokens.toLocaleString())}
          />
          <Stat label={t('stats.thinking')} value={`${thinkingMinutes}′${String(thinkingSeconds).padStart(2, '0')}″`} />
          <Stat label={t('stats.outputTokens')} value={aggregate.outputTokens.toLocaleString()} />
          <Stat label={t('stats.apiEffective')} value={effectiveTokens(aggregate).toLocaleString()} />
        </div>
      </section>

      <section className={css.card}>
        <div className={css.cardHead}>
          <h3 className={css.cardTitle}>{t('logs.title')}</h3>
          <button type="button" className={css.refresh} onClick={() => { setLogsOpen(!logsOpen) }}>
            {logsOpen ? t('logs.collapse') : t('logs.expand')}
          </button>
        </div>
        {logsOpen ? (
          logs.length === 0
            ? <p className={css.muted}>{t('logs.empty')}</p>
            : (
              <table className={css.table}>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>条数</th>
                    <th>结果</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry, index) => (
                    <tr key={`${entry.time}-${index}`}>
                      <td>{formatTime(entry.time)}</td>
                      <td>{entry.count} {t('logs.count')}</td>
                      <td className={entry.ok ? css.ok : css.error}>{entry.ok ? t('logs.success') : t('logs.failed')}</td>
                      <td className={css.muted}>{entry.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        ) : null}
      </section>

      <section className={css.card}>
        <h3 className={css.cardTitle}>{t('config.title')}</h3>
        <div className={css.fields}>
          <ToggleRow label={t('config.enabled')} checked={draft.enabled} onChange={(value) => { patch('enabled', value) }} />
          <ToggleRow label={t('config.reportEnabled')} checked={draft.reportEnabled} onChange={(value) => { patch('reportEnabled', value) }} />
          <NumberRow label={t('config.reportInterval')} value={draft.reportInterval} onChange={(value) => { patch('reportInterval', value) }} />
          <ToggleRow label={t('config.includeTokens')} checked={draft.includeTokens} onChange={(value) => { patch('includeTokens', value) }} />
          <ToggleRow label={t('config.includePrompts')} checked={draft.includePrompts} onChange={(value) => { patch('includePrompts', value) }} />
          <ToggleRow label={t('config.debug')} checked={draft.debug} onChange={(value) => { patch('debug', value) }} />
        </div>
        <div className={css.saveRow}>
          <button type="button" className={css.save} disabled={saving} onClick={save}>
            {saving ? t('config.saving') : t('config.save')}
          </button>
        </div>
      </section>

      {notice ? (
        <div className={notice.kind === 'ok' ? css.toastOk : css.toastError} role="status">
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}

/** 汇总指标小卡片(sub 为可选的辅助说明行) */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={css.stat}>
      <span className={css.statValue}>{value}</span>
      <span className={css.statLabel}>{label}</span>
      {sub ? <span className={css.statSub}>{sub}</span> : null}
    </div>
  )
}

/** 开关行 */
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => { onChange(event.target.checked) }} />
    </div>
  )
}

/** 数字输入行 */
function NumberRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <input
        className={css.input}
        type="number"
        min={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => { onChange(Number(event.target.value)) }}
      />
    </div>
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
