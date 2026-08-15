import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthInteraction, OAuthCredential } from '@earendil-works/pi-ai'
import { AuthController, AuthControllerError } from '../src/auth-controller.js'
import { OPENAI_CODEX_PROVIDER, SecureCredentialStore } from '../src/credential-store.js'

const roots: string[] = []

async function store(): Promise<SecureCredentialStore> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-openai-codex-oauth-controller-'))
  roots.push(home)
  return new SecureCredentialStore(home)
}

function credential(suffix = 'new'): OAuthCredential {
  return {
    type: 'oauth',
    access: `access-${suffix}`,
    refresh: `refresh-${suffix}`,
    expires: 2_000_000_000_000,
    accountId: `account-${suffix}`,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function eventually(check: () => boolean): Promise<void> {
  await vi.waitFor(() => { expect(check()).toBe(true) })
}

afterEach(async () => {
  delete process.env['PI_OAUTH_CALLBACK_HOST']
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('AuthController', () => {
  it('passes the explicit Browser choice to pi-ai and publishes only the trusted URL', async () => {
    const result = deferred<OAuthCredential>()
    const login = vi.fn(async (interaction: AuthInteraction) => {
      expect(await interaction.prompt({
        type: 'select', message: 'method', options: [
          { id: 'browser', label: 'Browser' },
          { id: 'device_code', label: 'Device' },
        ],
      })).toBe('browser')
      interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?state=public' })
      return result.promise
    })
    const credentials = await store()
    const controller = new AuthController(credentials, { login })

    const pending = await controller.start('browser')

    expect(pending).toMatchObject({
      state: 'pending', method: 'browser',
      browser: { authorizationUrl: 'https://auth.openai.com/oauth/authorize?state=public', callback: 'waiting' },
    })
    expect(JSON.stringify(pending)).not.toContain('account')
    result.resolve(credential())
    await eventually(() => controller.snapshot().state === 'connected')
    expect(await credentials.read(OPENAI_CODEX_PROVIDER)).toEqual(credential())
  })

  it('passes the explicit Device Code choice and exposes verification facts with expiry', async () => {
    const result = deferred<OAuthCredential>()
    const now = 1_000_000
    const login = vi.fn(async (interaction: AuthInteraction) => {
      expect(await interaction.prompt({ type: 'select', message: 'method', options: [] })).toBe('device_code')
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.openai.com/codex/device',
        intervalSeconds: 5,
        expiresInSeconds: 900,
      })
      return result.promise
    })
    const controller = new AuthController(await store(), { login, now: () => now })

    const pending = await controller.start('device_code')

    expect(pending).toMatchObject({
      state: 'pending', method: 'device_code',
      deviceCode: {
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.openai.com/codex/device',
        expiresAt: now + 900_000,
      },
    })
    result.resolve(credential())
    await eventually(() => controller.snapshot().state === 'connected')
  })

  it('makes a repeated method idempotent and conflicts with a different active method', async () => {
    const result = deferred<OAuthCredential>()
    const login = vi.fn(async (interaction: AuthInteraction) => {
      await interaction.prompt({ type: 'select', message: 'method', options: [] })
      interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize' })
      return Promise.race([
        result.promise,
        new Promise<never>((_resolve, reject) => {
          interaction.signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
        }),
      ])
    })
    const controller = new AuthController(await store(), { login })

    const first = await controller.start('browser')
    const repeated = await controller.start('browser')

    expect(repeated).toEqual(first)
    expect(login).toHaveBeenCalledTimes(1)
    await expect(controller.start('device_code')).rejects.toMatchObject({ code: 'AUTH_IN_PROGRESS' })
    await controller.cancel(first.attemptId)
  })

  it('lets cancellation win once and refuses a stale attempt id', async () => {
    const login = vi.fn(async (interaction: AuthInteraction) => {
      const method = await interaction.prompt({ type: 'select', message: 'method', options: [] })
      interaction.notify(method === 'browser'
        ? { type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize' }
        : { type: 'device_code', userCode: 'CODE', verificationUri: 'https://auth.openai.com/codex/device' })
      return new Promise<never>((_resolve, reject) => {
        interaction.signal?.addEventListener('abort', () => { reject(new Error('upstream secret on cancel')) }, { once: true })
      })
    })
    const controller = new AuthController(await store(), { login })
    const browser = await controller.start('browser')

    await expect(controller.cancel('wrong-attempt')).rejects.toMatchObject({ code: 'STALE_ATTEMPT' })
    await controller.cancel(browser.attemptId)
    expect(controller.snapshot()).toEqual({ state: 'disconnected' })

    const device = await controller.start('device_code')
    await expect(controller.cancel(browser.attemptId)).rejects.toMatchObject({ code: 'STALE_ATTEMPT' })
    expect(controller.snapshot()).toMatchObject({ state: 'pending', attemptId: device.attemptId })
    await controller.cancel(device.attemptId)
  })

  it('keeps an existing credential after failed replacement and redacts upstream errors', async () => {
    const credentials = await store()
    await credentials.modify(OPENAI_CODEX_PROVIDER, async () => credential('old'))
    const controller = new AuthController(credentials, {
      login: async (interaction) => {
        await interaction.prompt({ type: 'select', message: 'method', options: [] })
        interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize' })
        throw new Error('upstream access-token-secret')
      },
    })

    await controller.start('browser')
    await eventually(() => controller.snapshot().state === 'failed')

    expect(controller.snapshot()).toEqual({
      state: 'failed',
      error: { code: 'OAUTH_LOGIN_FAILED', message: 'OpenAI sign-in failed. Retry or choose another login method.' },
      connectedBeforeAttempt: true,
    })
    expect(JSON.stringify(controller.snapshot())).not.toContain('access-token-secret')
    expect(await credentials.read(OPENAI_CODEX_PROVIDER)).toEqual(credential('old'))
  })

  it('rejects non-loopback callback configuration before invoking pi-ai', async () => {
    process.env['PI_OAUTH_CALLBACK_HOST'] = '0.0.0.0'
    const login = vi.fn()
    const controller = new AuthController(await store(), { login })

    await expect(controller.start('browser')).rejects.toMatchObject({ code: 'UNSAFE_CALLBACK_HOST' })
    expect(login).not.toHaveBeenCalled()
  })

  it('maps a Browser callback collision to fixed Device Code guidance', async () => {
    const controller = new AuthController(await store(), {
      login: async (interaction) => {
        await interaction.prompt({ type: 'select', message: 'method', options: [] })
        throw Object.assign(new Error('listen EADDRINUSE 127.0.0.1:1455 secret'), { code: 'EADDRINUSE' })
      },
    })

    await controller.start('browser').catch(() => undefined)
    await eventually(() => controller.snapshot().state === 'failed')

    expect(controller.snapshot()).toMatchObject({
      state: 'failed',
      error: {
        code: 'BROWSER_CALLBACK_UNAVAILABLE',
        message: 'Browser callback port 1455 is unavailable. Retry after freeing it or choose Device Code.',
      },
    })
    expect(JSON.stringify(controller.snapshot())).not.toContain('secret')
  })

  it('aborts and settles active work during disposal', async () => {
    let aborted = false
    const controller = new AuthController(await store(), {
      login: async (interaction) => {
        await interaction.prompt({ type: 'select', message: 'method', options: [] })
        interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize' })
        return new Promise<never>((_resolve, reject) => {
          interaction.signal?.addEventListener('abort', () => {
            aborted = true
            reject(new Error('cancelled'))
          }, { once: true })
        })
      },
    })
    await controller.start('browser')

    await controller.dispose()

    expect(aborted).toBe(true)
    await expect(controller.start('device_code')).rejects.toBeInstanceOf(AuthControllerError)
  })

  it('can dispose an attempt before pi-ai publishes login instructions', async () => {
    let aborted = false
    const controller = new AuthController(await store(), {
      login: interaction => new Promise<never>((_resolve, reject) => {
        interaction.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('cancelled before notification'))
        }, { once: true })
      }),
    })

    const starting = controller.start('browser')
    await Promise.resolve()
    await controller.dispose()

    await expect(starting).rejects.toMatchObject({ code: 'AUTH_CANCELLED' })
    expect(aborted).toBe(true)
  }, 500)
})
