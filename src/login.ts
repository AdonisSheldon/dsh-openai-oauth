import { createInterface } from 'node:readline/promises'
import { stdin, stdout, stderr } from 'node:process'
import type { AuthStatus, LoginMethod, PendingStatus } from './auth-controller.js'
import { AuthControllerError } from './auth-controller.js'
import { createPluginRuntime } from './index.js'

const USAGE = `Usage: dsh-openai-codex-login [--browser | --device-code]

Options:
  --browser              Use PKCE browser login with a loopback callback
  --device-code          Use Device Code login for headless or remote browsers
  --method <method>      Use browser or device-code
  -h, --help             Show this help
`

class LoginUsageError extends Error {}

export interface LoginOptions {
  method?: LoginMethod
  help: boolean
}

export interface LoginController {
  start(method: LoginMethod): Promise<PendingStatus>
  waitForAttempt(attemptId: string): Promise<AuthStatus>
  cancel(attemptId: string): Promise<AuthStatus>
  dispose(): Promise<void>
}

export interface LoginIo {
  terminal: boolean
  question(prompt: string): Promise<string>
  write(value: string): void
  writeError(value: string): void
  close(): void
}

export interface RunLoginDependencies {
  io?: LoginIo
  createRuntime?: () => { controller: LoginController }
  signal?: AbortSignal
}

function normalizeMethod(value: string): LoginMethod | undefined {
  if (value === 'browser') return 'browser'
  if (value === 'device-code' || value === 'device_code') return 'device_code'
  return undefined
}

/** Parse one explicit login method without accepting implicit fallbacks. */
export function parseLoginArgs(argv: readonly string[]): LoginOptions {
  let method: LoginMethod | undefined
  let help = false

  const choose = (next: LoginMethod): void => {
    if (method !== undefined) throw new LoginUsageError('Choose exactly one login method.')
    method = next
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '-h' || argument === '--help') {
      help = true
    } else if (argument === '--browser') {
      choose('browser')
    } else if (argument === '--device-code') {
      choose('device_code')
    } else if (argument === '--method') {
      const value = argv[index + 1]
      if (value === undefined) throw new LoginUsageError('--method requires browser or device-code.')
      const selected = normalizeMethod(value)
      if (selected === undefined) throw new LoginUsageError('--method must be browser or device-code.')
      choose(selected)
      index += 1
    } else if (argument.startsWith('--method=')) {
      const selected = normalizeMethod(argument.slice('--method='.length))
      if (selected === undefined) throw new LoginUsageError('--method must be browser or device-code.')
      choose(selected)
    } else {
      throw new LoginUsageError(`Unknown option: ${argument}`)
    }
  }

  return method === undefined ? { help } : { method, help }
}

function processIo(): LoginIo {
  const readline = createInterface({ input: stdin, output: stdout })
  return {
    terminal: Boolean(stdin.isTTY && stdout.isTTY),
    question: prompt => readline.question(prompt),
    write: value => { stdout.write(value) },
    writeError: value => { stderr.write(value) },
    close: () => { readline.close() },
  }
}

async function selectMethod(options: LoginOptions, io: LoginIo): Promise<LoginMethod> {
  if (options.method !== undefined) return options.method
  if (!io.terminal) {
    throw new LoginUsageError('No interactive terminal. Pass --browser or --device-code.')
  }
  const answer = (await io.question(
    'Choose OpenAI login method:\n  1. Browser (recommended)\n  2. Device Code\nChoice [1]: ',
  )).trim().toLowerCase()
  if (answer === '' || answer === '1' || answer === 'browser') return 'browser'
  if (answer === '2' || answer === 'device-code' || answer === 'device_code') return 'device_code'
  throw new LoginUsageError('Choose 1 for Browser or 2 for Device Code.')
}

function printPending(status: PendingStatus, io: LoginIo): void {
  if (status.method === 'browser') {
    io.write(`Open this URL in your browser:\n${status.browser.authorizationUrl}\n\n`)
    io.write('Waiting for the one-time loopback callback on 127.0.0.1:1455…\n')
    return
  }
  io.write(`Open this URL:\n${status.deviceCode.verificationUri}\n\n`)
  io.write(`Enter this code: ${status.deviceCode.userCode}\n`)
  io.write(`The code expires at ${new Date(status.deviceCode.expiresAt).toISOString()}.\n`)
}

function fixedFailure(reason: unknown): string {
  return reason instanceof AuthControllerError
    ? reason.message
    : 'OpenAI sign-in failed. Retry or choose another login method.'
}

/** Run one selected OAuth attempt and persist credentials through the shared controller. */
export async function runLogin(
  argv: readonly string[],
  dependencies: RunLoginDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? processIo()
  let runtime: { controller: LoginController } | undefined
  let attemptId: string | undefined
  let interrupted = false
  let cancellation: Promise<AuthStatus> | undefined
  const interrupt = (): void => {
    interrupted = true
    if (attemptId !== undefined && runtime !== undefined && cancellation === undefined) {
      cancellation = runtime.controller.cancel(attemptId)
    }
  }

  dependencies.signal?.addEventListener('abort', interrupt, { once: true })
  try {
    let options: LoginOptions
    try {
      options = parseLoginArgs(argv)
      if (options.help) {
        io.write(USAGE)
        return 0
      }
      const method = await selectMethod(options, io)
      runtime = (dependencies.createRuntime ?? createPluginRuntime)()
      const pending = await runtime.controller.start(method)
      attemptId = pending.attemptId
      printPending(pending, io)
      if (dependencies.signal?.aborted) interrupt()
      const final = await runtime.controller.waitForAttempt(attemptId)
      if (cancellation !== undefined) await cancellation.catch(() => undefined)
      if (interrupted) {
        io.writeError('OpenAI sign-in cancelled.\n')
        return 130
      }
      if (final.state === 'connected') {
        io.write('OpenAI sign-in completed.\n')
        return 0
      }
      if (final.state === 'failed') io.writeError(`${final.error.message}\n`)
      else io.writeError('OpenAI sign-in did not complete.\n')
      return 1
    } catch (reason) {
      if (reason instanceof LoginUsageError) {
        io.writeError(`${reason.message}\n${USAGE}`)
        return 2
      }
      if (interrupted || dependencies.signal?.aborted) {
        io.writeError('OpenAI sign-in cancelled.\n')
        return 130
      }
      io.writeError(`${fixedFailure(reason)}\n`)
      return 1
    }
  } finally {
    dependencies.signal?.removeEventListener('abort', interrupt)
    await runtime?.controller.dispose()
    io.close()
  }
}
