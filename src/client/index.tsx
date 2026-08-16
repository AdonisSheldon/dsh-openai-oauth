import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
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
