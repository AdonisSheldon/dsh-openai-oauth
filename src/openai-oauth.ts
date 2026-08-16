import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AuthInteraction, OAuthCredential } from './oauth-types.js'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_BASE_URL = 'https://auth.openai.com'
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`
const BROWSER_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`
const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_PORT = 1455
const DEVICE_TIMEOUT_SECONDS = 15 * 60
const SCOPE = 'openid profile email offline_access'
const ACCOUNT_CLAIM = 'https://api.openai.com/auth'

type OAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface OpenAiOAuth {
  /** Run the explicitly selected browser or device-code flow. */
  login(interaction: AuthInteraction): Promise<OAuthCredential>
  /** Exchange one refresh token for a complete replacement credential. */
  refresh(credential: OAuthCredential, signal?: AbortSignal): Promise<OAuthCredential>
}

export interface OpenAiOAuthOptions {
  fetch?: OAuthFetch
  now?: () => number
  randomBytes?: (size: number) => Uint8Array
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  waitForCallback?: (state: string, signal?: AbortSignal) => Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Login cancelled')
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Login cancelled'))
      return
    }
    const complete = (): void => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = (): void => {
      clearTimeout(timer)
      reject(new Error('Login cancelled'))
    }
    const timer = setTimeout(complete, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

function accountIdOf(token: string): string | undefined {
  try {
    const payload = token.split('.')[1]
    if (payload === undefined) return undefined
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!isRecord(decoded)) return undefined
    const auth = decoded[ACCOUNT_CLAIM]
    if (!isRecord(auth)) return undefined
    const accountId = auth['chatgpt_account_id']
    return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined
  } catch {
    return undefined
  }
}

async function readJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`OpenAI OAuth ${operation} failed with status ${response.status}.`)
  const value: unknown = await response.json().catch(() => undefined)
  if (!isRecord(value)) throw new Error(`OpenAI OAuth ${operation} returned invalid JSON.`)
  return value
}

function credentialFromToken(value: Record<string, unknown>, now: number): OAuthCredential {
  const access = value['access_token']
  const refresh = value['refresh_token']
  const expiresIn = value['expires_in']
  if (typeof access !== 'string' || access.length === 0
    || typeof refresh !== 'string' || refresh.length === 0
    || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('OpenAI OAuth token response is missing required fields.')
  }
  const accountId = accountIdOf(access)
  if (accountId === undefined) throw new Error('OpenAI OAuth access token has no valid account claim.')
  return { type: 'oauth', access, refresh, expires: now + expiresIn * 1000, accountId }
}

function successPage(): string {
  return '<!doctype html><meta charset="utf-8"><title>OpenAI sign-in complete</title><p>OpenAI sign-in completed. You can close this window.</p>'
}

function errorPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>OpenAI sign-in failed</title><p>${message}</p>`
}

/** Wait for one state-bound OAuth callback on the fixed loopback listener. */
export function waitForLoopbackCallback(state: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (operation: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      server.close()
      operation()
    }
    const abort = (): void => { settle(() => { reject(new Error('Login cancelled')) }) }
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      if (url.pathname !== '/auth/callback') {
        response.statusCode = 404
        response.end(errorPage('Callback route not found.'))
        return
      }
      if (url.searchParams.get('state') !== state) {
        response.statusCode = 400
        response.end(errorPage('State mismatch.'))
        return
      }
      const code = url.searchParams.get('code')
      if (code === null || code.length === 0) {
        response.statusCode = 400
        response.end(errorPage('Missing authorization code.'))
        return
      }
      response.statusCode = 200
      response.end(successPage())
      settle(() => { resolve(code) })
    })
    server.once('error', error => { settle(() => { reject(error) }) })
    server.listen(CALLBACK_PORT, CALLBACK_HOST)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

async function exchange(
  fetch: OAuthFetch,
  code: string,
  verifier: string,
  redirectUri: string,
  now: () => number,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  cancelled(signal)
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: CLIENT_ID, code,
      code_verifier: verifier, redirect_uri: redirectUri,
    }),
    ...signal === undefined ? {} : { signal },
  })
  return credentialFromToken(await readJson(response, 'token exchange'), now())
}

/** Create the plugin-owned OpenAI OAuth implementation. */
export function createOpenAiOAuth(options: OpenAiOAuthOptions = {}): OpenAiOAuth {
  const fetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const randomBytes = options.randomBytes ?? nodeRandomBytes
  const sleep = options.sleep ?? defaultSleep
  const waitForCallback = options.waitForCallback ?? waitForLoopbackCallback

  const browser = async (interaction: AuthInteraction): Promise<OAuthCredential> => {
    const verifier = Buffer.from(randomBytes(32)).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = Buffer.from(randomBytes(16)).toString('hex')
    const authorization = new URL(AUTHORIZE_URL)
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: BROWSER_REDIRECT_URI,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'deepseek-harness',
    }).toString()
    const callback = waitForCallback(state, interaction.signal)
    interaction.notify({
      type: 'auth_url',
      url: authorization.toString(),
      instructions: 'Complete OpenAI sign-in in the browser.',
    })
    return exchange(fetch, await callback, verifier, BROWSER_REDIRECT_URI, now, interaction.signal)
  }

  const device = async (interaction: AuthInteraction): Promise<OAuthCredential> => {
    cancelled(interaction.signal)
    const start = await fetch(DEVICE_USER_CODE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID }),
      ...interaction.signal === undefined ? {} : { signal: interaction.signal },
    })
    const value = await readJson(start, 'device-code request')
    const deviceAuthId = value['device_auth_id']
    const userCode = value['user_code']
    const rawInterval = value['interval']
    const intervalSeconds = typeof rawInterval === 'string' ? Number(rawInterval) : rawInterval
    if (typeof deviceAuthId !== 'string' || deviceAuthId.length === 0
      || typeof userCode !== 'string' || userCode.length === 0
      || typeof intervalSeconds !== 'number' || !Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
      throw new Error('OpenAI OAuth device-code response is invalid.')
    }
    interaction.notify({
      type: 'device_code', userCode, verificationUri: DEVICE_VERIFICATION_URI,
      intervalSeconds, expiresInSeconds: DEVICE_TIMEOUT_SECONDS,
    })

    const deadline = now() + DEVICE_TIMEOUT_SECONDS * 1000
    let pollDelay = Math.max(1_000, intervalSeconds * 1000)
    while (now() <= deadline) {
      await sleep(pollDelay, interaction.signal)
      cancelled(interaction.signal)
      const response = await fetch(DEVICE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
        ...interaction.signal === undefined ? {} : { signal: interaction.signal },
      })
      if (response.ok) {
        const token = await readJson(response, 'device authorization')
        const code = token['authorization_code']
        const verifier = token['code_verifier']
        if (typeof code !== 'string' || code.length === 0
          || typeof verifier !== 'string' || verifier.length === 0) {
          throw new Error('OpenAI OAuth device authorization response is invalid.')
        }
        return exchange(fetch, code, verifier, DEVICE_REDIRECT_URI, now, interaction.signal)
      }
      if (response.status === 403 || response.status === 404) continue
      const pending: unknown = await response.json().catch(() => undefined)
      const error = isRecord(pending) ? pending['error'] : undefined
      const code = typeof error === 'string' ? error : isRecord(error) ? error['code'] : undefined
      if (code === 'deviceauth_authorization_pending') continue
      if (code === 'slow_down') {
        pollDelay += 5_000
        continue
      }
      throw new Error(`OpenAI OAuth device authorization failed with status ${response.status}.`)
    }
    throw new Error('OpenAI OAuth device code expired.')
  }

  return {
    async login(interaction) {
      const method = await interaction.prompt({
        type: 'select',
        message: 'Select OpenAI login method:',
        options: [
          { id: 'browser', label: 'Browser login' },
          { id: 'device_code', label: 'Device Code login' },
        ],
      })
      if (method === 'browser') return browser(interaction)
      if (method === 'device_code') return device(interaction)
      throw new Error('Unknown OpenAI login method.')
    },
    async refresh(credential, signal) {
      cancelled(signal)
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', refresh_token: credential.refresh, client_id: CLIENT_ID,
        }),
        ...signal === undefined ? {} : { signal },
      })
      return credentialFromToken(await readJson(response, 'token refresh'), now())
    },
  }
}
