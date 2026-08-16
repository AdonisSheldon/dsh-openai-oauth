import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createOpenAiOAuth, waitForLoopbackCallback } from '../src/openai-oauth.js'
import type { AuthEvent, AuthInteraction, AuthPrompt } from '../src/oauth-types.js'

function accessToken(accountId = 'account-1'): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })}.signature`
}

function interaction(method: 'browser' | 'device_code'): {
  value: AuthInteraction
  events: AuthEvent[]
} {
  const events: AuthEvent[] = []
  return {
    events,
    value: {
      prompt: async (prompt: AuthPrompt) => prompt.type === 'select' ? method : '',
      notify: event => { events.push(event) },
    },
  }
}

describe('OpenAI OAuth protocol', () => {
  it('accepts only the matching state on the fixed loopback callback', async () => {
    const waiting = waitForLoopbackCallback('expected-state')
    let settled = false
    void waiting.finally(() => { settled = true })
    let wrong: Response | undefined
    await vi.waitFor(async () => {
      wrong = await fetch('http://127.0.0.1:1455/auth/callback?state=wrong&code=attacker')
      expect(wrong.status).toBe(400)
    })
    expect(settled).toBe(false)

    const accepted = await fetch('http://127.0.0.1:1455/auth/callback?state=expected-state&code=valid-code')
    expect(accepted.status).toBe(200)
    await expect(waiting).resolves.toBe('valid-code')
  })

  it('rejects cleanly when the fixed Browser callback port is occupied', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(1455, '127.0.0.1', resolve)
    })
    try {
      await expect(waitForLoopbackCallback('state')).rejects.toMatchObject({ code: 'EADDRINUSE' })
    } finally {
      await new Promise<void>(resolve => { blocker.close(() => { resolve() }) })
    }
  })

  it('uses plugin-owned Browser PKCE and exchanges only the validated callback code', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({
        access_token: accessToken(), refresh_token: 'refresh-1', expires_in: 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    let callbackState = ''
    const oauth = createOpenAiOAuth({
      fetch,
      now: () => 1_000,
      randomBytes: size => Buffer.alloc(size, 7),
      waitForCallback: async (state) => {
        callbackState = state
        return 'authorization-code'
      },
    })
    const auth = interaction('browser')

    await expect(oauth.login(auth.value)).resolves.toEqual({
      type: 'oauth', access: accessToken(), refresh: 'refresh-1', expires: 3_601_000, accountId: 'account-1',
    })

    const event = auth.events[0]
    expect(event?.type).toBe('auth_url')
    if (event?.type !== 'auth_url') throw new Error('missing auth URL')
    const authorization = new URL(event.url)
    expect(authorization.origin).toBe('https://auth.openai.com')
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('originator')).toBe('deepseek-harness')
    expect(authorization.searchParams.get('state')).toBe(callbackState)
    expect(authorization.searchParams.get('originator')).not.toBe('pi')

    const token = requests[0]
    expect(token?.url).toBe('https://auth.openai.com/oauth/token')
    const body = new URLSearchParams(String(token?.init?.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('authorization-code')
    expect(body.get('code_verifier')).not.toBeNull()
  })

  it('runs Device Code login, polls pending authorization, and exchanges the returned verifier', async () => {
    const requests: RequestInit[] = []
    const responses = [
      new Response(JSON.stringify({ device_auth_id: 'device-1', user_code: 'ABCD-EFGH', interval: 0 }), { status: 200 }),
      new Response('', { status: 403 }),
      new Response(JSON.stringify({ authorization_code: 'device-code', code_verifier: 'device-verifier' }), { status: 200 }),
      new Response(JSON.stringify({ access_token: accessToken('account-2'), refresh_token: 'refresh-2', expires_in: 60 }), { status: 200 }),
    ]
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      return responses.shift() ?? new Response('', { status: 500 })
    })
    const sleep = vi.fn(async () => undefined)
    const oauth = createOpenAiOAuth({ fetch, sleep, now: () => 2_000 })
    const auth = interaction('device_code')

    await expect(oauth.login(auth.value)).resolves.toMatchObject({ accountId: 'account-2', expires: 62_000 })
    expect(auth.events).toEqual([{
      type: 'device_code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.openai.com/codex/device',
      intervalSeconds: 0,
      expiresInSeconds: 900,
    }])
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000, undefined)
    const exchange = requests[3]!
    expect(new URLSearchParams(String(exchange.body)).get('redirect_uri'))
      .toBe('https://auth.openai.com/deviceauth/callback')
  })

  it('refreshes a credential without returning or logging upstream response fields', async () => {
    const requests: RequestInit[] = []
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({
        access_token: accessToken('account-refreshed'), refresh_token: 'refresh-new', expires_in: 30,
      }), { status: 200 })
    })
    const oauth = createOpenAiOAuth({ fetch, now: () => 5_000 })

    await expect(oauth.refresh({
      type: 'oauth', access: 'expired', refresh: 'refresh-old', expires: 1, accountId: 'account-old',
    })).resolves.toEqual({
      type: 'oauth', access: accessToken('account-refreshed'), refresh: 'refresh-new', expires: 35_000,
      accountId: 'account-refreshed',
    })
    const request = requests[0]!
    expect(new URLSearchParams(String(request.body)).get('refresh_token')).toBe('refresh-old')
  })

  it('rejects token responses without an account claim', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'not-a-jwt', refresh_token: 'secret-refresh', expires_in: 30,
    }), { status: 200 }))
    const oauth = createOpenAiOAuth({ fetch, waitForCallback: async () => 'code' })

    await expect(oauth.login(interaction('browser').value)).rejects.toThrow('valid account claim')
  })
})
