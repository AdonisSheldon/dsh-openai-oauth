import { describe, expect, it, vi } from 'vitest'
import type { AuthStatus, PendingStatus } from '../src/auth-controller.js'
import { parseLoginArgs, runLogin, type LoginController, type LoginIo } from '../src/login.js'

function browserPending(): PendingStatus {
  return {
    state: 'pending',
    attemptId: 'attempt-browser',
    method: 'browser',
    browser: {
      authorizationUrl: 'https://auth.openai.com/oauth/authorize?state=public',
      callback: 'waiting',
    },
  }
}

function devicePending(): PendingStatus {
  return {
    state: 'pending',
    attemptId: 'attempt-device',
    method: 'device_code',
    deviceCode: {
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.openai.com/codex/device',
      expiresAt: Date.now() + 900_000,
    },
  }
}

function io(answer = '', terminal = true): LoginIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    terminal,
    stdout,
    stderr,
    question: vi.fn(async () => answer),
    write: value => { stdout.push(value) },
    writeError: value => { stderr.push(value) },
    close: vi.fn(),
  }
}

function controller(pending: PendingStatus, final: AuthStatus = { state: 'connected' }): LoginController {
  return {
    start: vi.fn(async () => pending),
    waitForAttempt: vi.fn(async () => final),
    cancel: vi.fn(async (): Promise<AuthStatus> => ({ state: 'disconnected' })),
    dispose: vi.fn(async () => {}),
  }
}

describe('headless login CLI', () => {
  it('parses only explicit, non-conflicting method flags', () => {
    expect(parseLoginArgs(['--browser'])).toEqual({ method: 'browser', help: false })
    expect(parseLoginArgs(['--device-code'])).toEqual({ method: 'device_code', help: false })
    expect(parseLoginArgs(['--method', 'device_code'])).toEqual({ method: 'device_code', help: false })
    expect(() => parseLoginArgs(['--browser', '--device-code'])).toThrow(/one login method/i)
    expect(() => parseLoginArgs(['--method', 'automatic'])).toThrow(/browser or device-code/i)
    expect(() => parseLoginArgs(['--unknown'])).toThrow(/unknown option/i)
  })

  it('requires a flag without an interactive terminal', async () => {
    const terminal = io('', false)
    const createRuntime = vi.fn()

    expect(await runLogin([], { io: terminal, createRuntime })).toBe(2)
    expect(terminal.stderr.join('')).toContain('--browser or --device-code')
    expect(createRuntime).not.toHaveBeenCalled()
  })

  it('prompts for an explicit Device Code choice and prints only public instructions', async () => {
    const terminal = io('2')
    const auth = controller(devicePending())

    expect(await runLogin([], { io: terminal, createRuntime: () => ({ controller: auth }) })).toBe(0)
    expect(terminal.question).toHaveBeenCalledOnce()
    expect(auth.start).toHaveBeenCalledWith('device_code')
    expect(auth.waitForAttempt).toHaveBeenCalledWith('attempt-device')
    expect(terminal.stdout.join('')).toContain('ABCD-EFGH')
    expect(terminal.stdout.join('')).toContain('https://auth.openai.com/codex/device')
    expect(auth.dispose).toHaveBeenCalledOnce()
  })

  it('runs Browser login without machine-binding language', async () => {
    const terminal = io()
    const auth = controller(browserPending())

    expect(await runLogin(['--browser'], { io: terminal, createRuntime: () => ({ controller: auth }) })).toBe(0)
    expect(auth.start).toHaveBeenCalledWith('browser')
    expect(terminal.stdout.join('')).toContain('https://auth.openai.com/oauth/authorize?state=public')
    expect(terminal.stdout.join('')).toContain('loopback callback')
    expect(terminal.stdout.join('')).not.toMatch(/bind|pair/i)
  })

  it('cancels only its named attempt when interrupted', async () => {
    const signal = new AbortController()
    const pending = browserPending()
    let complete!: (status: AuthStatus) => void
    const auth = controller(pending)
    auth.waitForAttempt = vi.fn(() => new Promise<AuthStatus>(resolve => { complete = resolve }))
    auth.cancel = vi.fn(async (): Promise<AuthStatus> => {
      complete({ state: 'disconnected' })
      return { state: 'disconnected' }
    })
    const terminal = io()

    const result = runLogin(['--browser'], {
      io: terminal,
      createRuntime: () => ({ controller: auth }),
      signal: signal.signal,
    })
    await vi.waitFor(() => { expect(auth.waitForAttempt).toHaveBeenCalledOnce() })
    signal.abort()

    expect(await result).toBe(130)
    expect(auth.cancel).toHaveBeenCalledWith('attempt-browser')
    expect(auth.dispose).toHaveBeenCalledOnce()
  })

  it('redacts unexpected failures at the command boundary', async () => {
    const terminal = io()
    const auth = controller(browserPending())
    auth.start = vi.fn(async () => { throw new Error('access_token=secret') })

    expect(await runLogin(['--browser'], { io: terminal, createRuntime: () => ({ controller: auth }) })).toBe(1)
    expect(terminal.stderr.join('')).toBe('OpenAI sign-in failed. Retry or choose another login method.\n')
    expect(terminal.stderr.join('')).not.toContain('secret')
    expect(auth.dispose).toHaveBeenCalledOnce()
  })
})
