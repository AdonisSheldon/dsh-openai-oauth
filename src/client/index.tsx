import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
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
  section: { maxWidth: 720, padding: '0 0 32px' },
  title: { fontSize: 20, lineHeight: 1.3, margin: '0 0 8px' },
  intro: { color: 'var(--color-text-secondary, #667085)', lineHeight: 1.55, margin: '0 0 20px' },
  panel: { border: '1px solid var(--color-border, #d0d5dd)', borderRadius: 10, padding: 20 },
  heading: { fontSize: 14, margin: '0 0 10px' },
  status: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, fontWeight: 600 },
  dot: { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' },
  fieldset: { border: 0, borderTop: '1px solid var(--color-border, #e4e7ec)', margin: '20px 0 0', padding: '18px 0 0' },
  choice: { display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: '2px 8px', marginTop: 12, cursor: 'pointer' },
  choiceHelp: { color: 'var(--color-text-secondary, #667085)', fontSize: 13, lineHeight: 1.45, gridColumn: '2' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  pending: { background: 'var(--color-surface-subtle, #f8fafc)', borderRadius: 8, marginTop: 18, padding: 14, lineHeight: 1.5 },
  code: { display: 'inline-block', fontSize: 20, fontWeight: 700, letterSpacing: '0.08em', margin: '8px 0' },
  error: { color: 'var(--color-danger, #b42318)', margin: '14px 0 0' },
  secondary: { color: 'var(--color-text-secondary, #667085)', fontSize: 13 },
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

/** Dedicated settings section for the plugin-owned OAuth state machine. */
export function OpenAiOAuthSection({ t }: OpenAiOAuthSectionProps): ReactNode {
  const [status, setStatus] = useState<AuthStatus>()
  const [method, setMethod] = useState<LoginMethod>('browser')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

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

  const connected = status?.state === 'connected'
  const statusText = status === undefined
    ? t('loading')
    : connected ? t('connected') : status.state === 'failed' ? t('failed') : t('disconnected')
  const statusColor = connected ? '#079455' : status?.state === 'failed' ? '#d92d20' : '#98a2b3'
  return (
    <section style={styles.section} aria-labelledby="openai-oauth-title">
      <h2 id="openai-oauth-title" style={styles.title}>{t('title')}</h2>
      <p style={styles.intro}>{t('intro')}</p>
      <div style={styles.panel}>
        <h3 style={styles.heading}>{t('status')}</h3>
        <div style={styles.status} role="status" aria-live="polite">
          <span aria-hidden="true" style={{ ...styles.dot, background: statusColor }} />
          {statusText}
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
          <div style={styles.pending} aria-live="polite">
            {status.method === 'browser' ? (
              <>
                <p>{t('browserWaiting')}</p>
                <a href={status.browser.authorizationUrl} target="_blank" rel="noreferrer">{t('continueBrowser')}</a>
              </>
            ) : (
              <>
                <p>{t('deviceInstructions')}</p>
                <code style={styles.code}>{status.deviceCode.userCode}</code><br />
                <a href={status.deviceCode.verificationUri} target="_blank" rel="noreferrer">{t('openVerification')}</a>
                <p style={styles.secondary}>{t('expires', { time: new Date(status.deviceCode.expiresAt).toLocaleTimeString() })}</p>
              </>
            )}
          </div>
        ) : null}

        {status?.state === 'failed' ? <p style={styles.error} role="alert">{status.error.message}</p> : null}
        {error === undefined ? null : <p style={styles.error} role="alert">{error}</p>}

        <div style={styles.actions}>
          {connected
            ? <Button variant="outline" disabled={busy} onClick={() => { void logout() }}>{t('signOut')}</Button>
            : status?.state === 'pending'
              ? <Button variant="outline" disabled={busy} onClick={() => { void cancel() }}>{t('cancel')}</Button>
              : <Button variant="primary" disabled={busy || status === undefined} onClick={() => { void start() }}>{t('signIn')}</Button>}
          <Button variant="outline" disabled={busy} onClick={() => { void refresh() }}>{t('refresh')}</Button>
        </div>
      </div>
    </section>
  )
}

const NS = 'settings.openai-oauth'
export const inject = ['slots', 'locale']

/** Register bilingual copy and the dedicated settings page. */
export function apply(ctx: ClientContext): void {
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
