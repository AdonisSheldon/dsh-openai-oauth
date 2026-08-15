import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  CredentialStore,
  OAuthCredential,
} from '@earendil-works/pi-ai'
import { OPENAI_CODEX_PROVIDER } from './credential-store.js'

/** Login methods presented by pi-ai's OpenAI Codex OAuth provider. */
export type LoginMethod = 'browser' | 'device_code'

export interface RedactedAuthError {
  code: string
  message: string
}

export interface DisconnectedStatus {
  state: 'disconnected'
}

export interface ConnectedStatus {
  state: 'connected'
}

export interface BrowserPendingStatus {
  state: 'pending'
  attemptId: string
  method: 'browser'
  browser: {
    authorizationUrl: string
    callback: 'waiting'
  }
}

export interface DeviceCodePendingStatus {
  state: 'pending'
  attemptId: string
  method: 'device_code'
  deviceCode: {
    userCode: string
    verificationUri: string
    expiresAt: number
  }
}

export type PendingStatus = BrowserPendingStatus | DeviceCodePendingStatus

export interface FailedStatus {
  state: 'failed'
  error: RedactedAuthError
  connectedBeforeAttempt: boolean
}

/** Every redacted state exposed to the Host route and Client. */
export type AuthStatus = DisconnectedStatus | ConnectedStatus | PendingStatus | FailedStatus

/** Stable controller failure safe to translate at the local Host boundary. */
export class AuthControllerError extends Error {
  /**
   * @param code - stable failure code.
   * @param message - fixed text containing no upstream error detail.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AuthControllerError'
  }
}

export interface AuthControllerOptions {
  /** Run the provider-owned OAuth interaction and return its credential. */
  login: (interaction: AuthInteraction) => Promise<OAuthCredential>
  /** Injectable clock for deterministic expiry projection. */
  now?: () => number
}

type AttemptWinner = 'cancel' | 'complete' | 'failure'

interface Attempt {
  id: string
  method: LoginMethod
  connectedBefore: boolean
  abort: AbortController
  winner?: AttemptWinner
  publicStatus?: PendingStatus
  ready: Promise<PendingStatus>
  resolveReady: (status: PendingStatus) => void
  rejectReady: (error: AuthControllerError) => void
  readySettled: boolean
  done: Promise<void>
}

function cloneStatus(status: AuthStatus): AuthStatus {
  if (status.state === 'pending') {
    return status.method === 'browser'
      ? { ...status, browser: { ...status.browser } }
      : { ...status, deviceCode: { ...status.deviceCode } }
  }
  if (status.state === 'failed') return { ...status, error: { ...status.error } }
  return { ...status }
}

function callbackHostIsLoopback(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true
  const plain = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return isIP(plain) === 4 && plain.startsWith('127.')
}

function trustedOpenAiUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com'
      || url.username.length > 0 || url.password.length > 0) return undefined
    return url
  } catch {
    return undefined
  }
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const abort = (): void => {
      reject(new AuthControllerError('AUTH_CANCELLED', 'OpenAI sign-in was cancelled.'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function redactedFailure(method: LoginMethod, error: unknown): AuthControllerError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : ''
  const message = error instanceof Error ? error.message : ''
  if (method === 'browser' && (code === 'EADDRINUSE' || /EADDRINUSE|Missing authorization code/i.test(message))) {
    return new AuthControllerError(
      'BROWSER_CALLBACK_UNAVAILABLE',
      'Browser callback port 1455 is unavailable. Retry after freeing it or choose Device Code.',
    )
  }
  if (method === 'device_code' && /expired|timed?\s*out/i.test(message)) {
    return new AuthControllerError(
      'DEVICE_CODE_EXPIRED',
      'The OpenAI device code expired. Start Device Code login again.',
    )
  }
  return new AuthControllerError(
    'OAUTH_LOGIN_FAILED',
    'OpenAI sign-in failed. Retry or choose another login method.',
  )
}

/**
 * One dual-method OAuth state machine. It owns cancellation and persistence,
 * while pi-ai owns the OpenAI protocol and token exchange.
 */
export class AuthController {
  private statusValue: AuthStatus = { state: 'disconnected' }
  private active: Attempt | undefined
  private disposed = false
  private mutation: Promise<void> = Promise.resolve()
  private readonly now: () => number

  /**
   * @param credentials - plugin-owned persistent pi-ai credential store.
   * @param options - provider login operation and deterministic helpers.
   */
  constructor(
    private readonly credentials: CredentialStore,
    private readonly options: AuthControllerOptions,
  ) {
    this.now = options.now ?? Date.now
  }

  /** Return a detached synchronous view containing no credential fields. */
  snapshot(): AuthStatus {
    return cloneStatus(this.statusValue)
  }

  /** Reconcile the initial durable credential before returning redacted state. */
  async status(): Promise<AuthStatus> {
    if (this.active === undefined && this.statusValue.state === 'disconnected') {
      if (await this.credentials.read(OPENAI_CODEX_PROVIDER) !== undefined) {
        this.statusValue = { state: 'connected' }
      }
    }
    return this.snapshot()
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(() => undefined, () => undefined)
    return result
  }

  private settleReady(attempt: Attempt, outcome: PendingStatus | AuthControllerError): void {
    if (attempt.readySettled) return
    attempt.readySettled = true
    if (outcome instanceof AuthControllerError) attempt.rejectReady(outcome)
    else attempt.resolveReady(cloneStatus(outcome) as PendingStatus)
  }

  private pendingFromEvent(attempt: Attempt, event: AuthEvent): PendingStatus | undefined {
    if (event.type === 'info' || event.type === 'progress') return undefined
    if (event.type === 'auth_url') {
      if (attempt.method !== 'browser') {
        throw new AuthControllerError('OAUTH_PROTOCOL_ERROR', 'OpenAI sign-in returned data for the wrong login method.')
      }
      const url = trustedOpenAiUrl(event.url)
      if (url === undefined) {
        throw new AuthControllerError('OAUTH_PROTOCOL_ERROR', 'OpenAI sign-in returned an invalid authorization URL.')
      }
      return {
        state: 'pending',
        attemptId: attempt.id,
        method: 'browser',
        browser: { authorizationUrl: url.toString(), callback: 'waiting' },
      }
    }
    if (attempt.method !== 'device_code') {
      throw new AuthControllerError('OAUTH_PROTOCOL_ERROR', 'OpenAI sign-in returned data for the wrong login method.')
    }
    const verification = trustedOpenAiUrl(event.verificationUri)
    if (verification === undefined || event.userCode.length === 0) {
      throw new AuthControllerError('OAUTH_PROTOCOL_ERROR', 'OpenAI sign-in returned invalid device-code data.')
    }
    const expiresInSeconds = event.expiresInSeconds ?? 15 * 60
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new AuthControllerError('OAUTH_PROTOCOL_ERROR', 'OpenAI sign-in returned invalid device-code data.')
    }
    return {
      state: 'pending',
      attemptId: attempt.id,
      method: 'device_code',
      deviceCode: {
        userCode: event.userCode,
        verificationUri: verification.toString(),
        expiresAt: this.now() + expiresInSeconds * 1000,
      },
    }
  }

  private interaction(attempt: Attempt): AuthInteraction {
    return {
      signal: attempt.abort.signal,
      prompt: async (prompt: AuthPrompt): Promise<string> => {
        if (prompt.type === 'select') return attempt.method
        if (prompt.type === 'manual_code') {
          const signal = prompt.signal === undefined
            ? attempt.abort.signal
            : AbortSignal.any([attempt.abort.signal, prompt.signal])
          return waitForAbort(signal)
        }
        throw new AuthControllerError('OAUTH_PROTOCOL_ERROR', 'OpenAI sign-in requested an unsupported prompt.')
      },
      notify: (event) => {
        const status = this.pendingFromEvent(attempt, event)
        if (status === undefined || attempt.winner !== undefined || this.active !== attempt) return
        attempt.publicStatus = status
        this.statusValue = status
        this.settleReady(attempt, status)
      },
    }
  }

  private async run(attempt: Attempt): Promise<void> {
    try {
      const credential = await this.options.login(this.interaction(attempt))
      if (attempt.winner !== undefined) return
      attempt.winner = 'complete'
      await this.credentials.modify(OPENAI_CODEX_PROVIDER, async () => credential)
      if (this.active === attempt) {
        this.active = undefined
        this.statusValue = { state: 'connected' }
      }
      if (attempt.publicStatus === undefined) {
        this.settleReady(attempt, new AuthControllerError(
          'OAUTH_PROTOCOL_ERROR',
          'OpenAI sign-in completed without presenting login instructions.',
        ))
      }
    } catch (error) {
      if (attempt.winner === 'cancel') {
        this.settleReady(attempt, new AuthControllerError('AUTH_CANCELLED', 'OpenAI sign-in was cancelled.'))
        return
      }
      attempt.winner = 'failure'
      const redacted = error instanceof AuthControllerError ? error : redactedFailure(attempt.method, error)
      if (this.active === attempt) {
        this.active = undefined
        this.statusValue = {
          state: 'failed',
          error: { code: redacted.code, message: redacted.message },
          connectedBeforeAttempt: attempt.connectedBefore,
        }
      }
      this.settleReady(attempt, redacted)
    }
  }

  /** Start exactly the selected flow, returning once its public instructions exist. */
  async start(method: LoginMethod): Promise<PendingStatus> {
    const pending = await this.exclusive(async () => {
      if (this.disposed) throw new AuthControllerError('AUTH_DISPOSED', 'OpenAI sign-in is unavailable because the plugin is stopping.')
      if (method !== 'browser' && method !== 'device_code') {
        throw new AuthControllerError('INVALID_LOGIN_METHOD', 'Login method must be browser or device_code.')
      }
      if (method === 'browser') {
        const callbackHost = process.env['PI_OAUTH_CALLBACK_HOST']
        if (callbackHost !== undefined && !callbackHostIsLoopback(callbackHost)) {
          throw new AuthControllerError(
            'UNSAFE_CALLBACK_HOST',
            'Browser login requires a loopback PI_OAUTH_CALLBACK_HOST. Choose Device Code for another machine.',
          )
        }
      }
      if (this.active !== undefined) {
        if (this.active.method !== method) {
          throw new AuthControllerError('AUTH_IN_PROGRESS', 'Another OpenAI login method is already in progress; cancel it first.')
        }
        return { ready: this.active.ready }
      }

      const connectedBefore = await this.credentials.read(OPENAI_CODEX_PROVIDER) !== undefined
      let resolveReady!: (status: PendingStatus) => void
      let rejectReady!: (error: AuthControllerError) => void
      const ready = new Promise<PendingStatus>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      const attempt: Attempt = {
        id: randomUUID(),
        method,
        connectedBefore,
        abort: new AbortController(),
        ready,
        resolveReady,
        rejectReady,
        readySettled: false,
        done: Promise.resolve(),
      }
      this.active = attempt
      attempt.done = this.run(attempt)
      return { ready }
    })
    return pending.ready
  }

  /** Cancel only the named current attempt and await provider cleanup. */
  async cancel(attemptId: string): Promise<AuthStatus> {
    const done = await this.exclusive(async () => {
      const attempt = this.active
      if (attempt === undefined || attempt.id !== attemptId || attempt.winner !== undefined) {
        throw new AuthControllerError('STALE_ATTEMPT', 'The OpenAI login attempt is no longer active.')
      }
      attempt.winner = 'cancel'
      attempt.abort.abort('OpenAI sign-in cancelled')
      this.active = undefined
      this.statusValue = attempt.connectedBefore ? { state: 'connected' } : { state: 'disconnected' }
      return attempt.done
    })
    await done
    return this.snapshot()
  }

  /** Abort any attempt, then remove only the plugin-owned credential. */
  async logout(): Promise<AuthStatus> {
    const attempt = this.active
    if (attempt !== undefined && attempt.winner === undefined) await this.cancel(attempt.id)
    await this.credentials.delete(OPENAI_CODEX_PROVIDER)
    this.statusValue = { state: 'disconnected' }
    return this.snapshot()
  }

  /** Abort and settle active provider work before plugin effects unwind. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.mutation
    const attempt = this.active
    if (attempt !== undefined && attempt.winner === undefined) {
      await this.cancel(attempt.id)
    } else if (attempt !== undefined) {
      await attempt.done
    }
  }
}
