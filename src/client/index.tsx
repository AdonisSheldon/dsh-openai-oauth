import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button, Input, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { AuthStatus, LoginMethod, PendingStatus } from '../auth-controller.js'
import { OAUTH_ROUTE_PATH } from '../protocol.js'
import { en, zh, type OAuthLocaleKey } from './locales.js'

export interface OpenAiOAuthSectionInjected {
  t: (key: OAuthLocaleKey, params?: Record<string, string | number>) => string
}

export type OpenAiOAuthSectionProps = SettingsSectionOwnerProps & OpenAiOAuthSectionInjected

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dedicated OpenAI OAuth settings copy. */
    'settings.openai-oauth': OAuthLocaleKey
  }
}

const styles: Record<string, CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, padding: '0 0 32px', color: 'var(--dsw-alias-label-primary)' },
  title: { fontSize: 18, fontWeight: 600, lineHeight: '24px', margin: 0 },
  intro: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px', margin: 0 },
  panel: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 },
  statusSummary: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 36, paddingBottom: 16, borderBottom: '1px solid var(--dsw-alias-border-l2)' },
  heading: { fontSize: 14, fontWeight: 500, lineHeight: '22px', margin: 0 },
  status: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 22, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
  dot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
  fieldset: { border: 0, margin: 0, padding: 0 },
  choice: { display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: '2px 8px', marginTop: 12, cursor: 'pointer' },
  choiceHelp: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', gridColumn: '2' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pending: { display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--dsw-alias-bg-module-platform)', borderRadius: 12, padding: '14px 16px' },
  pendingLead: { display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr)', alignItems: 'start', gap: 10 },
  pendingDot: { width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: 'var(--dsw-alias-state-business-primary)' },
  pendingTitle: { fontSize: 14, fontWeight: 500, lineHeight: '22px', margin: 0 },
  pendingHelp: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: '2px 0 0' },
  pendingActions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 20 },
  primaryLink: { boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, padding: '0 14px', borderRadius: 18, background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)', fontSize: 14, lineHeight: '22px', textDecoration: 'none' },
  codeButton: { display: 'flex', alignItems: 'center', gap: 10, width: 'fit-content', margin: '8px 0 0', padding: '6px 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer' },
  code: { fontSize: 18, fontWeight: 600, letterSpacing: '0.08em' },
  copyHint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' },
  error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '18px', margin: 0 },
  secondary: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: '6px 0 0' },
  models: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8, paddingTop: 20, borderTop: '1px solid var(--dsw-alias-border-l2)' },
  modelsHeader: { display: 'flex', flexDirection: 'column', gap: 2 },
  warning: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 12, lineHeight: '18px', margin: 0 },
  modelList: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1, margin: 0, padding: 0, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, overflow: 'hidden' },
  modelRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr) auto auto', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1)' },
  modelMain: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  modelName: { fontSize: 13, fontWeight: 500, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
  modelId: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
  modelMeta: { display: 'flex', flexWrap: 'wrap', gap: '2px 16px', margin: 0 },
  modelMetaGroup: { display: 'flex', flexDirection: 'column', gap: 2, margin: 0 },
  modelMetaLabel: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-caption)' },
  modelMetaValue: { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
  badge: { justifySelf: 'start', padding: '2px 8px', borderRadius: 999, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap' },
  badgeBuiltIn: { background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-secondary)' },
  badgeCustom: { background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-state-business-primary)' },
  badgeOverridden: { background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-state-warn-primary)' },
  modelActions: { display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'end' },
  form: { display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--dsw-alias-bg-module-platform)', borderRadius: 12, padding: '14px 16px' },
  formTitle: { fontSize: 13, fontWeight: 500, lineHeight: '20px', margin: 0 },
  formFields: { display: 'flex', flexDirection: 'column', gap: 12 },
  fieldPair: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', minWidth: 0 },
  fieldLabel: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
  hint: { fontSize: 11, lineHeight: '16px', margin: 0, color: 'var(--dsw-alias-label-caption)' },
  formActions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
}

async function hostRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${OAUTH_ROUTE_PATH}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...body === undefined ? {} : { 'content-type': 'application/json' },
    },
    ...body === undefined ? {} : { body: JSON.stringify(body) },
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null
      && 'error' in value && typeof value.error === 'object' && value.error !== null
      && 'message' in value.error && typeof value.error.message === 'string'
      ? value.error.message
      : undefined
    throw new Error(message ?? 'The local Harness Host did not complete the OAuth request.')
  }
  return value as T
}

function trustedAuthorizationUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'auth.openai.com'
      && url.username.length === 0 && url.password.length === 0
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

/** Model id accepted by the Host: 1-64 of letter/digit/dot/underscore/colon/dash, starting alphanumeric. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const MODEL_CONTEXT_WINDOW_MIN = 1024
const MODEL_CONTEXT_WINDOW_MAX = 10000000
const MODEL_NAME_MAX_LENGTH = 64
const MODEL_NAME_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/

/** One row of the Host model list. Declared locally because the Host catalog is built in parallel. */
interface ModelRow {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  builtIn: boolean
  overridden: boolean
  defaultContextWindow: number | null
  defaultMaxTokens: number | null
}

interface ModelListView {
  models: ModelRow[]
  /** Present only when the stored file is unusable; a non-blocking warning code. */
  warning: string | undefined
}

type ModelField = 'id' | 'name' | 'contextWindow' | 'maxTokens'
type ModelFieldErrors = Partial<Record<ModelField, OAuthLocaleKey>>

type ModelSaveBody =
  | { id: string; contextWindow: number; maxTokens: number }
  | { id: string; name: string; contextWindow: number; maxTokens: number }

interface ModelDraft {
  mode: 'add' | 'edit'
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  /** A built-in row keeps its id and name; only the two numbers are editable. */
  locked: boolean
  defaultContextWindow: number | null
  defaultMaxTokens: number | null
}

function isModelRow(value: unknown): value is ModelRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  const nullableNumber = (input: unknown): boolean => input === null || typeof input === 'number'
  return typeof row.id === 'string'
    && typeof row.name === 'string'
    && typeof row.contextWindow === 'number'
    && typeof row.maxTokens === 'number'
    && typeof row.builtIn === 'boolean'
    && typeof row.overridden === 'boolean'
    && nullableNumber(row.defaultContextWindow)
    && nullableNumber(row.defaultMaxTokens)
}

/** Read the list view, or undefined when the Host answered with an unexpected shape. */
function readModelListView(value: unknown): ModelListView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const view = value as { models?: unknown; error?: unknown }
  if (!Array.isArray(view.models)) return undefined
  const models: ModelRow[] = []
  for (const entry of view.models) {
    if (!isModelRow(entry)) return undefined
    models.push(entry)
  }
  return { models, warning: typeof view.error === 'string' ? view.error : undefined }
}

function readInteger(raw: string): number | undefined {
  const text = raw.trim()
  return /^\d+$/.test(text) ? Number(text) : undefined
}

/** Mirror the Host validation so problems appear before the request; the Host stays authoritative. */
function validateDraft(draft: ModelDraft): ModelFieldErrors {
  const errors: ModelFieldErrors = {}
  if (!MODEL_ID_PATTERN.test(draft.id)) errors.id = 'validationId'
  if (draft.name.length > MODEL_NAME_MAX_LENGTH || MODEL_NAME_CONTROL_PATTERN.test(draft.name)) {
    errors.name = 'validationName'
  }
  const contextWindow = readInteger(draft.contextWindow)
  if (contextWindow === undefined || contextWindow < MODEL_CONTEXT_WINDOW_MIN || contextWindow > MODEL_CONTEXT_WINDOW_MAX) {
    errors.contextWindow = 'validationContextWindow'
  }
  const maxTokens = readInteger(draft.maxTokens)
  if (maxTokens === undefined || maxTokens < 1 || (contextWindow !== undefined && maxTokens > contextWindow)) {
    errors.maxTokens = 'validationMaxTokens'
  }
  return errors
}

function blankDraft(): ModelDraft {
  return {
    mode: 'add',
    id: '',
    name: '',
    contextWindow: '',
    maxTokens: '',
    locked: false,
    defaultContextWindow: null,
    defaultMaxTokens: null,
  }
}

function draftFor(row: ModelRow): ModelDraft {
  return {
    mode: 'edit',
    id: row.id,
    name: row.name,
    contextWindow: String(row.contextWindow),
    maxTokens: String(row.maxTokens),
    locked: row.builtIn,
    defaultContextWindow: row.defaultContextWindow,
    defaultMaxTokens: row.defaultMaxTokens,
  }
}

/** Join the ids of the description elements that are actually rendered. */
function joinIds(...ids: (string | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== undefined)
  return present.length === 0 ? undefined : present.join(' ')
}

const MODEL_FIELD_IDS = {
  id: 'openai-oauth-model-id',
  name: 'openai-oauth-model-name',
  contextWindow: 'openai-oauth-model-context-window',
  maxTokens: 'openai-oauth-model-max-tokens',
} as const

/** Dedicated settings section for the plugin-owned OAuth state machine. */
export function OpenAiOAuthSection({ t }: OpenAiOAuthSectionProps): ReactNode {
  const [status, setStatus] = useState<AuthStatus>()
  const [method, setMethod] = useState<LoginMethod>('browser')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [copiedCode, setCopiedCode] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await hostRequest<AuthStatus>('/status'))
      setError(undefined)
    } catch {
      setError(t('requestFailed'))
    }
  }, [t])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (status?.state !== 'pending') return
    const timer = window.setTimeout(() => { void refresh() }, 1000)
    return () => { window.clearTimeout(timer) }
  }, [refresh, status])

  const start = async (): Promise<void> => {
    const popup = (method === 'browser' ? window.open('about:blank', '_blank') : null) ?? null
    if (popup !== null) popup.opener = null
    setBusy(true)
    setError(undefined)
    try {
      const pending = await hostRequest<PendingStatus>('/start', { method })
      setStatus(pending)
      if (pending.method === 'browser') {
        const url = trustedAuthorizationUrl(pending.browser.authorizationUrl)
        if (url === undefined) throw new Error(t('requestFailed'))
        if (popup !== null) popup.location.href = url
      }
    } catch (reason) {
      popup?.close()
      setError(reason instanceof Error ? reason.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (status?.state !== 'pending') return
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await hostRequest<AuthStatus>('/cancel', { attemptId: status.attemptId }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await hostRequest<AuthStatus>('/logout', {}))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const copyDeviceCode = async (code: string): Promise<void> => {
    if (await writeClipboard(code)) {
      setCopiedCode(code)
      setError(undefined)
      return
    }
    setCopiedCode(undefined)
    setError(t('copyFailed'))
  }

  const connected = status?.state === 'connected'
  const deviceCodeCopied = status?.state === 'pending'
    && status.method === 'device_code'
    && copiedCode === status.deviceCode.userCode
  const statusText = status === undefined
    ? t('loading')
    : connected
      ? t('connected')
      : status.state === 'pending'
        ? t('pending')
        : status.state === 'failed'
          ? t('failed')
          : t('disconnected')
  const statusColor = connected
    ? 'var(--dsw-alias-state-success-primary)'
    : status?.state === 'failed'
      ? 'var(--dsw-alias-state-error-primary)'
      : status === undefined
        ? 'var(--dsw-alias-state-business-primary)'
        : 'var(--dsw-alias-label-caption)'
  return (
    <section style={styles.section} aria-labelledby="openai-oauth-title">
      <h2 id="openai-oauth-title" style={styles.title}>{t('title')}</h2>
      <p style={styles.intro}>{t('intro')}</p>
      <div style={styles.panel}>
        <div style={styles.statusSummary}>
          <h3 style={styles.heading}>{t('status')}</h3>
          <div style={styles.status} role="status" aria-live="polite">
            <span aria-hidden="true" style={{ ...styles.dot, background: statusColor }} />
            {statusText}
          </div>
        </div>

        {!connected && status?.state !== 'pending' ? (
          <fieldset style={styles.fieldset} disabled={busy}>
            <legend style={styles.heading}>{t('methodLegend')}</legend>
            <label style={styles.choice}>
              <input type="radio" name="openai-login-method" value="browser" checked={method === 'browser'} onChange={() => { setMethod('browser') }} />
              <span>{t('browser')}</span>
              <span style={styles.choiceHelp}>{t('browserHelp')}</span>
            </label>
            <label style={styles.choice}>
              <input type="radio" name="openai-login-method" value="device_code" checked={method === 'device_code'} onChange={() => { setMethod('device_code') }} />
              <span>{t('device')}</span>
              <span style={styles.choiceHelp}>{t('deviceHelp')}</span>
            </label>
          </fieldset>
        ) : null}

        {status?.state === 'pending' ? (
          <div style={styles.pending} data-oauth-state="pending" aria-live="polite">
            {status.method === 'browser' ? (
              <>
                <div style={styles.pendingLead}>
                  <span style={styles.pendingDot} aria-hidden="true" />
                  <div>
                    <p style={styles.pendingTitle}>{t('browserWaiting')}</p>
                    <p style={styles.pendingHelp}>{t('browserWaitingHelp')}</p>
                  </div>
                </div>
                <div style={styles.pendingActions}>
                  <a style={styles.primaryLink} href={status.browser.authorizationUrl} target="_blank" rel="noreferrer">
                    {t('continueBrowser')} <span aria-hidden="true">↗</span>
                  </a>
                  <Button variant="ghost" disabled={busy} onClick={() => { void cancel() }}>{t('cancel')}</Button>
                </div>
              </>
            ) : (
              <>
                <div style={styles.pendingLead}>
                  <span style={styles.pendingDot} aria-hidden="true" />
                  <div>
                    <p style={styles.pendingTitle}>{t('deviceInstructions')}</p>
                    <button
                      type="button"
                      style={styles.codeButton}
                      aria-label={t(deviceCodeCopied ? 'copiedCode' : 'copyCode')}
                      onClick={() => { void copyDeviceCode(status.deviceCode.userCode) }}
                    >
                      <code style={styles.code}>{status.deviceCode.userCode}</code>
                      <span
                        aria-hidden="true"
                        style={{ ...styles.copyHint, ...(deviceCodeCopied ? { color: 'var(--dsw-alias-state-success-primary)' } : {}) }}
                      >
                        {t(deviceCodeCopied ? 'copied' : 'copyHint')}
                      </span>
                    </button>
                    <p style={styles.secondary}>{t('expires', { time: new Date(status.deviceCode.expiresAt).toLocaleTimeString() })}</p>
                  </div>
                </div>
                <div style={styles.pendingActions}>
                  <a style={styles.primaryLink} href={status.deviceCode.verificationUri} target="_blank" rel="noreferrer">
                    {t('openVerification')} <span aria-hidden="true">↗</span>
                  </a>
                  <Button variant="ghost" disabled={busy} onClick={() => { void cancel() }}>{t('cancel')}</Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {status?.state === 'failed' ? <p style={styles.error} role="alert">{status.error.message}</p> : null}
        {error === undefined ? null : <p style={styles.error} role="alert">{error}</p>}

        <div style={styles.actions}>
          {status?.state === 'pending' ? null : connected
            ? <Button variant="outline" disabled={busy} onClick={() => { void logout() }}>{t('signOut')}</Button>
            : <Button variant="primary" disabled={busy || status === undefined} onClick={() => { void start() }}>{t('signIn')}</Button>}
          {status?.state === 'pending' ? null : (
            <Button variant="ghost" disabled={busy} onClick={() => { void refresh() }}>{t('refresh')}</Button>
          )}
        </div>
      </div>

      <ModelListBlock t={t} />
    </section>
  )
}

/** Model list block rendered inside the OAuth settings section, below the OAuth panel. */
function ModelListBlock({ t }: OpenAiOAuthSectionInjected): ReactNode {
  const [models, setModels] = useState<ModelRow[]>()
  const [loadError, setLoadError] = useState<string>()
  const [warning, setWarning] = useState<string>()
  const [requestError, setRequestError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<ModelDraft>()
  const [fieldErrors, setFieldErrors] = useState<ModelFieldErrors>({})
  const requested = useRef(false)

  const applyView = useCallback((view: ModelListView): void => {
    setModels(view.models)
    setWarning(view.warning)
    setLoadError(undefined)
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setRequestError(undefined)
    try {
      const view = readModelListView(await hostRequest<unknown>('/models'))
      if (view === undefined) throw new Error(t('requestFailed'))
      applyView(view)
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }, [applyView, t])

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    void load()
  }, [load])

  const openAdd = (): void => {
    setDraft(blankDraft())
    setFieldErrors({})
    setRequestError(undefined)
  }

  const openEdit = (row: ModelRow): void => {
    setDraft(draftFor(row))
    setFieldErrors({})
    setRequestError(undefined)
  }

  const closeDraft = (): void => {
    setDraft(undefined)
    setFieldErrors({})
    setRequestError(undefined)
  }

  const updateDraft = (field: ModelField, value: string): void => {
    setDraft(current => {
      if (current === undefined) return undefined
      const next: ModelDraft = { ...current }
      next[field] = value
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (draft === undefined || busy) return
    const errors = validateDraft(draft)
    setFieldErrors(errors)
    if (errors.id !== undefined || errors.name !== undefined || errors.contextWindow !== undefined || errors.maxTokens !== undefined) return
    const contextWindow = readInteger(draft.contextWindow)
    const maxTokens = readInteger(draft.maxTokens)
    if (contextWindow === undefined || maxTokens === undefined) return
    const body: ModelSaveBody = draft.locked || draft.name.length === 0
      ? { id: draft.id, contextWindow, maxTokens }
      : { id: draft.id, name: draft.name, contextWindow, maxTokens }
    setBusy(true)
    setRequestError(undefined)
    try {
      const view = readModelListView(await hostRequest<unknown>('/models/save', body))
      if (view === undefined) throw new Error(t('requestFailed'))
      applyView(view)
      setDraft(undefined)
      setFieldErrors({})
    } catch (reason) {
      setRequestError(reason instanceof Error ? reason.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: ModelRow): Promise<void> => {
    if (busy) return
    setBusy(true)
    setRequestError(undefined)
    try {
      const view = readModelListView(await hostRequest<unknown>('/models/remove', { id: row.id }))
      if (view === undefined) throw new Error(t('requestFailed'))
      applyView(view)
      setDraft(current => current !== undefined && current.mode === 'edit' && current.id === row.id ? undefined : current)
    } catch (reason) {
      setRequestError(reason instanceof Error ? reason.message : t('requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const badgeStyle = (row: ModelRow): CSSProperties | undefined => row.overridden
    ? styles.badgeOverridden
    : row.builtIn ? styles.badgeBuiltIn : styles.badgeCustom
  const badgeLabel = (row: ModelRow): OAuthLocaleKey => row.overridden
    ? 'badgeOverridden'
    : row.builtIn ? 'badgeBuiltIn' : 'badgeCustom'
  const idError = fieldErrors.id
  const nameError = fieldErrors.name
  const contextWindowError = fieldErrors.contextWindow
  const maxTokensError = fieldErrors.maxTokens

  return (
    <div style={styles.models} aria-labelledby="openai-oauth-models-title">
      <div style={styles.modelsHeader}>
        <h3 id="openai-oauth-models-title" style={styles.heading}>{t('modelsTitle')}</h3>
        <p style={styles.intro}>{t('modelsIntro')}</p>
      </div>

      {warning === undefined ? null : <p style={styles.warning} role="status">{t('modelsWarning', { code: warning })}</p>}
      {loadError === undefined ? null : <p style={styles.error} role="alert">{loadError}</p>}
      {requestError === undefined ? null : <p style={styles.error} role="alert">{requestError}</p>}

      {models === undefined
        ? loadError === undefined ? <p style={styles.secondary} role="status">{t('modelsLoading')}</p> : null
        : models.length === 0
          ? <p style={styles.secondary}>{t('modelsEmpty')}</p>
          : (
            <ul style={styles.modelList}>
              {models.map(row => (
                <li key={row.id} style={styles.modelRow}>
                  <div style={styles.modelMain}>
                    <span style={styles.modelName}>{row.name}</span>
                    <code style={styles.modelId}>{row.id}</code>
                  </div>
                  <dl style={styles.modelMeta}>
                    <div style={styles.modelMetaGroup}>
                      <dt style={styles.modelMetaLabel}>{t('contextWindowLabel')}</dt>
                      <dd style={styles.modelMetaValue}>{row.contextWindow.toLocaleString()}</dd>
                    </div>
                    <div style={styles.modelMetaGroup}>
                      <dt style={styles.modelMetaLabel}>{t('maxTokensLabel')}</dt>
                      <dd style={styles.modelMetaValue}>{row.maxTokens.toLocaleString()}</dd>
                    </div>
                  </dl>
                  <span style={{ ...styles.badge, ...badgeStyle(row) }}>{t(badgeLabel(row))}</span>
                  <div style={styles.modelActions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={t('actionEdit') + ': ' + row.name}
                      onClick={() => { openEdit(row) }}
                    >
                      {t('actionEdit')}
                    </Button>
                    {row.builtIn
                      ? row.overridden
                        ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={t('actionReset') + ': ' + row.name}
                            onClick={() => { void remove(row) }}
                          >
                            {t('actionReset')}
                          </Button>
                        )
                        : null
                      : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={t('actionDelete') + ': ' + row.name}
                          onClick={() => { void remove(row) }}
                        >
                          {t('actionDelete')}
                        </Button>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}

      {draft === undefined ? (
        <div style={styles.formActions}>
          <Button variant="primary" disabled={busy} onClick={openAdd}>{t('actionAddModel')}</Button>
          {loadError === undefined ? null : <Button variant="ghost" disabled={busy} onClick={() => { void load() }}>{t('actionRetry')}</Button>}
        </div>
      ) : (
        <form style={styles.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <p style={styles.formTitle}>{draft.mode === 'add' ? t('addModelTitle') : t('editModelTitle', { id: draft.id })}</p>
          <div style={styles.formFields}>
            <div style={styles.field}>
              <label style={styles.fieldLabel} htmlFor={MODEL_FIELD_IDS.id}>{t('fieldId')}</label>
              <Input
                id={MODEL_FIELD_IDS.id}
                value={draft.id}
                readOnly={draft.locked}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={idError !== undefined}
                aria-describedby={idError === undefined ? undefined : MODEL_FIELD_IDS.id + '-error'}
                onChange={(event) => { updateDraft('id', event.target.value) }}
              />
              {idError === undefined ? null : <p id={MODEL_FIELD_IDS.id + '-error'} style={styles.error} role="alert">{t(idError)}</p>}
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel} htmlFor={MODEL_FIELD_IDS.name}>{t('fieldName')}</label>
              <Input
                id={MODEL_FIELD_IDS.name}
                value={draft.name}
                readOnly={draft.locked}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={nameError !== undefined}
                aria-describedby={nameError === undefined ? undefined : MODEL_FIELD_IDS.name + '-error'}
                onChange={(event) => { updateDraft('name', event.target.value) }}
              />
              {nameError === undefined ? null : <p id={MODEL_FIELD_IDS.name + '-error'} style={styles.error} role="alert">{t(nameError)}</p>}
            </div>

            <div style={styles.fieldPair}>
              <div style={styles.field}>
                <label style={styles.fieldLabel} htmlFor={MODEL_FIELD_IDS.contextWindow}>{t('fieldContextWindow')}</label>
                <Input
                  id={MODEL_FIELD_IDS.contextWindow}
                  value={draft.contextWindow}
                  disabled={busy}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={contextWindowError !== undefined}
                  aria-describedby={joinIds(
                    draft.locked && draft.defaultContextWindow !== null ? MODEL_FIELD_IDS.contextWindow + '-default' : undefined,
                    contextWindowError === undefined ? undefined : MODEL_FIELD_IDS.contextWindow + '-error',
                  )}
                  onChange={(event) => { updateDraft('contextWindow', event.target.value) }}
                />
                {draft.locked && draft.defaultContextWindow !== null
                  ? <p id={MODEL_FIELD_IDS.contextWindow + '-default'} style={styles.hint}>{t('builtInDefault', { value: draft.defaultContextWindow.toLocaleString() })}</p>
                  : null}
                {contextWindowError === undefined ? null : <p id={MODEL_FIELD_IDS.contextWindow + '-error'} style={styles.error} role="alert">{t(contextWindowError)}</p>}
              </div>

              <div style={styles.field}>
                <label style={styles.fieldLabel} htmlFor={MODEL_FIELD_IDS.maxTokens}>{t('fieldMaxTokens')}</label>
                <Input
                  id={MODEL_FIELD_IDS.maxTokens}
                  value={draft.maxTokens}
                  disabled={busy}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={maxTokensError !== undefined}
                  aria-describedby={joinIds(
                    draft.locked && draft.defaultMaxTokens !== null ? MODEL_FIELD_IDS.maxTokens + '-default' : undefined,
                    maxTokensError === undefined ? undefined : MODEL_FIELD_IDS.maxTokens + '-error',
                  )}
                  onChange={(event) => { updateDraft('maxTokens', event.target.value) }}
                />
                {draft.locked && draft.defaultMaxTokens !== null
                  ? <p id={MODEL_FIELD_IDS.maxTokens + '-default'} style={styles.hint}>{t('builtInDefault', { value: draft.defaultMaxTokens.toLocaleString() })}</p>
                  : null}
                {maxTokensError === undefined ? null : <p id={MODEL_FIELD_IDS.maxTokens + '-error'} style={styles.error} role="alert">{t(maxTokensError)}</p>}
              </div>
            </div>
          </div>
          <div style={styles.formActions}>
            <Button type="submit" variant="primary" disabled={busy}>{t('actionSave')}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={closeDraft}>{t('actionCancel')}</Button>
          </div>
        </form>
      )}
    </div>
  )
}

const NS = 'settings.openai-oauth'
export const inject = ['slots', 'locale']

/** Register bilingual copy and the dedicated settings page. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'openai-oauth: client copy')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'openai-oauth',
    order: 11,
    label: () => t('nav'),
    inject: () => ({ t }),
  }, OpenAiOAuthSection))
}
