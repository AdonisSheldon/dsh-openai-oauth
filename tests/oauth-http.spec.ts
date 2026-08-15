import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus, PendingStatus } from '../src/auth-controller.js'
import {
  OAUTH_ROUTE_PATH,
  isLoopbackAddress,
  oauthRoute,
  type OAuthHttpController,
} from '../src/oauth-http.js'

const close: (() => Promise<void>)[] = []

function controller(): OAuthHttpController & {
  start: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
} {
  const disconnected: AuthStatus = { state: 'disconnected' }
  return {
    status: vi.fn(async () => disconnected),
    start: vi.fn(async (method: 'browser' | 'device_code'): Promise<PendingStatus> => method === 'browser'
      ? {
          state: 'pending', attemptId: 'attempt-1', method,
          browser: { authorizationUrl: 'https://auth.openai.com/oauth/authorize', callback: 'waiting' },
        }
      : {
          state: 'pending', attemptId: 'attempt-1', method,
          deviceCode: { userCode: 'CODE', verificationUri: 'https://auth.openai.com/codex/device', expiresAt: 123 },
        }),
    cancel: vi.fn(async () => disconnected),
    logout: vi.fn(async () => disconnected),
  }
}

async function serve(auth: OAuthHttpController): Promise<{ origin: string; host: string }> {
  const route = oauthRoute(auth, async () => [{ id: 'gpt-test', name: 'GPT Test' }])
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  close.push(() => new Promise<void>(resolve => { server.close(() => { resolve() }) }))
  const port = (server.address() as AddressInfo).port
  return { origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` }
}

async function post(origin: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function rawRequest(origin: string, host: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const target = new URL(`${origin}${OAUTH_ROUTE_PATH}/status`)
    const req = httpRequest({ hostname: target.hostname, port: target.port, path: target.pathname, headers: { host } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

afterEach(async () => {
  await Promise.all(close.splice(0).map(stop => stop()))
})

describe('OAuth Host route', () => {
  it('returns only redacted state and model identifiers with defensive headers', async () => {
    const auth = controller()
    const { origin } = await serve(auth)

    const response = await fetch(`${origin}${OAUTH_ROUTE_PATH}/status`)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.json()).toEqual({ state: 'disconnected', models: [{ id: 'gpt-test', name: 'GPT Test' }] })
  })

  it('starts the explicitly selected Browser or Device Code method', async () => {
    const auth = controller()
    const { origin } = await serve(auth)

    const browser = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'browser' })
    const device = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'device_code' })

    expect(browser.status).toBe(200)
    expect(await browser.json()).toMatchObject({ state: 'pending', method: 'browser' })
    expect(device.status).toBe(200)
    expect(await device.json()).toMatchObject({ state: 'pending', method: 'device_code' })
    expect(auth.start.mock.calls).toEqual([['browser'], ['device_code']])
  })

  it('rejects an untrusted Host, missing or cross-origin Origin, and cross-site fetch metadata', async () => {
    const auth = controller()
    const { origin } = await serve(auth)

    const badHost = await rawRequest(origin, 'attacker.example')
    const missingOrigin = await fetch(`${origin}${OAUTH_ROUTE_PATH}/start`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{"method":"browser"}',
    })
    const crossOrigin = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'browser' }, { origin: 'https://attacker.example' })
    const crossSite = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'browser' }, { 'sec-fetch-site': 'cross-site' })

    expect(badHost.status).toBe(403)
    expect(missingOrigin.status).toBe(403)
    expect(crossOrigin.status).toBe(403)
    expect(crossSite.status).toBe(403)
    expect(auth.start).not.toHaveBeenCalled()
  })

  it('rejects invalid methods, media types, fields, and oversized bodies before controller calls', async () => {
    const auth = controller()
    const { origin } = await serve(auth)

    const media = await fetch(`${origin}${OAUTH_ROUTE_PATH}/start`, {
      method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' }, body: '{}',
    })
    const method = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'automatic' })
    const fields = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'browser', token: 'secret' })
    const oversized = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'browser', padding: 'x'.repeat(5000) })
    const unsupported = await fetch(`${origin}${OAUTH_ROUTE_PATH}/status`, { method: 'DELETE' })

    expect(media.status).toBe(415)
    expect(method.status).toBe(400)
    expect(fields.status).toBe(400)
    expect(oversized.status).toBe(413)
    expect(unsupported.status).toBe(405)
    expect(auth.start).not.toHaveBeenCalled()
  })

  it('validates cancellation identity, logs out, and redacts all controller failures', async () => {
    const auth = controller()
    auth.start.mockRejectedValueOnce(new Error('upstream-token-secret'))
    const { origin } = await serve(auth)

    const invalidCancel = await post(origin, `${OAUTH_ROUTE_PATH}/cancel`, { attemptId: '' })
    const cancel = await post(origin, `${OAUTH_ROUTE_PATH}/cancel`, { attemptId: 'attempt-1' })
    const logout = await post(origin, `${OAUTH_ROUTE_PATH}/logout`, {})
    const failed = await post(origin, `${OAUTH_ROUTE_PATH}/start`, { method: 'browser' })

    expect(invalidCancel.status).toBe(400)
    expect(cancel.status).toBe(200)
    expect(logout.status).toBe(200)
    expect(failed.status).toBe(500)
    const failureBody = await failed.text()
    expect(JSON.parse(failureBody)).toEqual({
      error: { code: 'OAUTH_INTERNAL_ERROR', message: 'OpenAI OAuth operation failed.' },
    })
    expect(failureBody).not.toContain('upstream-token-secret')
  })

  it('recognizes only IPv4 and IPv6 loopback peers', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.9')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('0.0.0.0')).toBe(false)
    expect(isLoopbackAddress('192.168.1.2')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})
