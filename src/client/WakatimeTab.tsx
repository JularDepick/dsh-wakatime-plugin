/*
 * WakaTime 设置标签页组件
 * 作者: JularDepick
 *
 * 数据面板:认证状态、汇总战绩与按会话统计;配置区:Web 可编辑项的
 * 表单与保存。数据经 host webserver 接口读写(仅 web profile 提供,
 * 接口缺失时展示加载失败提示)。
 */

import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WebConfigPayload, WebStatusResponse } from '../webui/types'
import css from './WakatimeTab.module.css'

/** 注册点推导的组件 props(settings.plugins.tab 无 owner props) */
export type WakatimeTabProps = PropsRuntime<'settings.plugins.tab'>

/** 配置草稿:status.config 的可编辑子集 */
interface ConfigDraft {
  enabled: boolean
  locale: string
  clientId: string
  callbackPort: number
  heartbeatInterval: number
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
const LOCALE_OPTIONS = ['zh-CN', 'en-US'] as const

/**
 * 渲染 wakatime 标签页。
 * @param _props - 框架注入的运行时座位(本页不消费会话座位)。
 * @returns 数据面板与配置区。
 */
export function WakatimeTab(_props: WakatimeTabProps) {
  const [data, setData] = useState<WebStatusResponse | null>(null)
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [loadError, setLoadError] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)

  /* 拉取状态:接口缺失(非 web profile)时保留错误提示 */
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
  }

  useEffect(() => { reload() }, [tick])

  /* 保存成功提示 3 秒后自动消失 */
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
      .then(() => { setNotice({ kind: 'ok', text: '配置已保存' }) })
      .catch((error: unknown) => { setNotice({ kind: 'error', text: `保存失败: ${(error as Error).message}` }) })
      .finally(() => { setSaving(false) })
  }

  if (loadError !== undefined && data === null) {
    return (
      <div className={css.tab}>
        <p className={css.error} role="status">
          加载失败:{loadError}(Web 接口仅在 web profile 提供)
        </p>
      </div>
    )
  }
  if (data === null || draft === null) {
    return (
      <div className={css.tab}>
        <p className={css.muted}>加载中…</p>
      </div>
    )
  }

  const { authenticated, username, expiresAt } = data
  const aggregate = data.stats.aggregate

  return (
    <div className={css.tab}>
      <section className={css.card}>
        <div className={css.cardHead}>
          <h3 className={css.cardTitle}>认证状态</h3>
          <button type="button" className={css.refresh} onClick={() => { setTick((value) => value + 1) }}>
            刷新
          </button>
        </div>
        {authenticated
          ? (
            <p className={css.ok} role="status">
              已连接:{username ?? 'WakaTime 用户'}
              {expiresAt !== undefined ? ` · 令牌过期:${formatTime(expiresAt * 1000)}` : ''}
            </p>
          )
          : (
            <p className={css.muted}>
              未认证。在会话中调用 wakatime_login 工具完成授权。
            </p>
          )}
      </section>

      <section className={css.card}>
        <h3 className={css.cardTitle}>会话战绩</h3>
        <div className={css.grid}>
          <Stat label="心跳上报" value={aggregate.heartbeats} />
          <Stat label="工具调用" value={aggregate.toolCalls} />
          <Stat label="用户消息" value={aggregate.userMessages} />
          <Stat label="输入 Token" value={aggregate.inputTokens} />
          <Stat label="输出 Token" value={aggregate.outputTokens} />
          <Stat label="缓存读取" value={aggregate.cacheReadTokens} />
          <Stat label="缓存写入" value={aggregate.cacheWriteTokens} />
          <Stat label="推理 Token" value={aggregate.reasoningTokens} />
        </div>
      </section>

      <section className={css.card}>
        <h3 className={css.cardTitle}>按会话统计</h3>
        {data.stats.sessions.length === 0
          ? <p className={css.muted}>暂无会话数据。</p>
          : (
            <table className={css.table}>
              <thead>
                <tr>
                  <th>会话 ID</th>
                  <th>心跳</th>
                  <th>工具调用</th>
                  <th>输入 Token</th>
                  <th>输出 Token</th>
                </tr>
              </thead>
              <tbody>
                {data.stats.sessions.map((row) => (
                  <tr key={row.sessionId}>
                    <td className={css.sessionId}>{row.sessionId}</td>
                    <td>{row.heartbeats}</td>
                    <td>{row.toolCalls}</td>
                    <td>{row.inputTokens}</td>
                    <td>{row.outputTokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>

      <section className={css.card}>
        <h3 className={css.cardTitle}>配置</h3>
        <div className={css.fields}>
          <ToggleRow label="启用上报" checked={draft.enabled} onChange={(value) => { patch('enabled', value) }} />
          <ToggleRow label="上报 Token 用量" checked={draft.includeTokens} onChange={(value) => { patch('includeTokens', value) }} />
          <ToggleRow label="上报提示词长度" checked={draft.includePrompts} onChange={(value) => { patch('includePrompts', value) }} />
          <ToggleRow label="调试日志" checked={draft.debug} onChange={(value) => { patch('debug', value) }} />
          <div className={css.row}>
            <span className={css.rowLabel}>界面语言</span>
            <select
              className={css.select}
              value={draft.locale}
              onChange={(event) => { patch('locale', event.target.value) }}
            >
              {LOCALE_OPTIONS.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
            </select>
          </div>
          <TextRow label="Client ID" value={draft.clientId} onChange={(value) => { patch('clientId', value) }} />
          <NumberRow label="回调端口" value={draft.callbackPort} onChange={(value) => { patch('callbackPort', value) }} />
          <NumberRow label="心跳间隔(秒)" value={draft.heartbeatInterval} onChange={(value) => { patch('heartbeatInterval', value) }} />
        </div>
        <div className={css.saveRow}>
          <button type="button" className={css.save} disabled={saving} onClick={save}>
            {saving ? '保存中…' : '保存配置'}
          </button>
          <p className={css.hint}>保存后即时生效并持久化;clientSecret 请经 WAKATIME_CLIENT_SECRET 环境变量注入。</p>
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

/** 汇总指标小卡片 */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={css.stat}>
      <span className={css.statValue}>{value.toLocaleString()}</span>
      <span className={css.statLabel}>{label}</span>
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

/** 文本输入行 */
function TextRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <input
        className={css.input}
        type="text"
        value={value}
        onChange={(event) => { onChange(event.target.value) }}
      />
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
        min={0}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => { onChange(Number(event.target.value)) }}
      />
    </div>
  )
}

function fromConfig(config: WebStatusResponse['config']): ConfigDraft {
  return {
    enabled: config.enabled,
    locale: config.locale,
    clientId: config.clientId,
    callbackPort: config.callbackPort,
    heartbeatInterval: config.heartbeatInterval,
    includeTokens: config.includeTokens,
    includePrompts: config.includePrompts,
    debug: config.debug,
  }
}

function toPayload(draft: ConfigDraft): WebConfigPayload {
  return {
    enabled: draft.enabled,
    locale: draft.locale,
    clientId: draft.clientId,
    callbackPort: draft.callbackPort,
    heartbeatInterval: draft.heartbeatInterval,
    includeTokens: draft.includeTokens,
    includePrompts: draft.includePrompts,
    debug: draft.debug,
  }
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
