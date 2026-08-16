import { randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import lockfile from 'proper-lockfile'
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from '@earendil-works/pi-ai'

/** The single pi-ai provider owned by this plugin. */
export const OPENAI_CODEX_PROVIDER = 'openai-codex'

const ENVELOPE_VERSION = 1
const STATE_DIRECTORY_NAME = 'dsh-openai-oauth'
const CREDENTIAL_FILE_NAME = 'credentials.json'

interface CredentialEnvelope {
  version: typeof ENVELOPE_VERSION
  credentials: Partial<Record<typeof OPENAI_CODEX_PROVIDER, OAuthCredential>>
}

/** Stable storage failure with no credential or file contents in its message. */
export class CredentialStoreError extends Error {
  /**
   * @param code - stable diagnostic code safe to expose after route mapping.
   * @param message - fixed, redacted diagnostic text.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CredentialStoreError'
  }
}

function invalidCredentialFile(): CredentialStoreError {
  return new CredentialStoreError(
    'INVALID_CREDENTIAL_FILE',
    'OpenAI Codex credential file is invalid; log out or remove the plugin credential file and sign in again.',
  )
}

function unsafePath(): CredentialStoreError {
  return new CredentialStoreError(
    'UNSAFE_CREDENTIAL_PATH',
    'OpenAI Codex credential storage uses an unsafe path; replace links with owner-only directories and retry.',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function parseCredential(value: unknown): OAuthCredential {
  if (!isRecord(value) || !exactKeys(value, ['type', 'access', 'refresh', 'expires', 'accountId'])) {
    throw invalidCredentialFile()
  }
  if (value['type'] !== 'oauth'
    || typeof value['access'] !== 'string' || value['access'].length === 0
    || typeof value['refresh'] !== 'string' || value['refresh'].length === 0
    || typeof value['expires'] !== 'number' || !Number.isFinite(value['expires']) || value['expires'] <= 0
    || typeof value['accountId'] !== 'string' || value['accountId'].length === 0) {
    throw invalidCredentialFile()
  }
  return {
    type: 'oauth',
    access: value['access'],
    refresh: value['refresh'],
    expires: value['expires'],
    accountId: value['accountId'],
  }
}

function parseEnvelope(text: string): CredentialEnvelope {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw invalidCredentialFile()
  }
  if (!isRecord(value) || !exactKeys(value, ['version', 'credentials']) || value['version'] !== ENVELOPE_VERSION) {
    throw invalidCredentialFile()
  }
  const credentials = value['credentials']
  if (!isRecord(credentials) || !Object.keys(credentials).every(key => key === OPENAI_CODEX_PROVIDER)) {
    throw invalidCredentialFile()
  }
  const stored = credentials[OPENAI_CODEX_PROVIDER]
  return {
    version: ENVELOPE_VERSION,
    credentials: stored === undefined ? {} : { [OPENAI_CODEX_PROVIDER]: parseCredential(stored) },
  }
}

function cloneCredential(credential: OAuthCredential): OAuthCredential {
  return { ...credential }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT'
}

/**
 * Owner-only, versioned pi-ai credential store rooted below one Harness home.
 * All writes and deletion are serialized by an OS-visible lock and replace the
 * credential file atomically.
 */
export class SecureCredentialStore implements CredentialStore {
  /** Plugin-owned state directory. */
  readonly stateDirectory: string
  /** Versioned credential envelope path. */
  readonly credentialFile: string

  /**
   * @param dshHome - resolved Harness home directory.
   */
  constructor(private readonly dshHome: string) {
    this.stateDirectory = resolve(dshHome, 'plugins', STATE_DIRECTORY_NAME)
    this.credentialFile = join(this.stateDirectory, CREDENTIAL_FILE_NAME)
  }

  private async assertDirectory(path: string, create: boolean): Promise<void> {
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      if (!isMissing(error) || !create) throw error
      await mkdir(path, { recursive: true, mode: 0o700 })
      info = await lstat(path)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafePath()
    await chmod(path, 0o700)
  }

  private async ensureStateDirectory(): Promise<void> {
    await mkdir(this.dshHome, { recursive: true, mode: 0o700 })
    const plugins = resolve(this.dshHome, 'plugins')
    await this.assertDirectory(plugins, true)
    await this.assertDirectory(this.stateDirectory, true)
  }

  private async readEnvelope(): Promise<CredentialEnvelope | undefined> {
    let info
    try {
      info = await lstat(this.credentialFile)
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
    if (info.isSymbolicLink() || !info.isFile()) throw unsafePath()
    if ((info.mode & 0o077) !== 0) {
      throw new CredentialStoreError(
        'UNSAFE_CREDENTIAL_PERMISSIONS',
        'OpenAI Codex credential file permissions are unsafe; restrict the file to its owner and retry.',
      )
    }
    return parseEnvelope(await readFile(this.credentialFile, 'utf8'))
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureStateDirectory()
    const release = await lockfile.lock(this.stateDirectory, {
      realpath: false,
      stale: 30_000,
      update: 10_000,
      retries: { retries: 80, factor: 1.15, minTimeout: 10, maxTimeout: 150 },
    })
    try {
      return await operation()
    } finally {
      await release()
    }
  }

  private async writeCredential(credential: OAuthCredential): Promise<void> {
    const envelope: CredentialEnvelope = {
      version: ENVELOPE_VERSION,
      credentials: { [OPENAI_CODEX_PROVIDER]: cloneCredential(credential) },
    }
    const temporary = join(this.stateDirectory, `.${CREDENTIAL_FILE_NAME}.${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, this.credentialFile)
      await chmod(this.credentialFile, 0o600)
      if (process.platform !== 'win32') {
        const directory = await open(this.stateDirectory, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
    } finally {
      await handle?.close()
      try {
        await unlink(temporary)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    if (providerId !== OPENAI_CODEX_PROVIDER) return undefined
    await this.ensureStateDirectory()
    const stored = (await this.readEnvelope())?.credentials[OPENAI_CODEX_PROVIDER]
    return stored === undefined ? undefined : cloneCredential(stored)
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const credential = await this.read(OPENAI_CODEX_PROVIDER)
    return credential === undefined ? [] : [{ providerId: OPENAI_CODEX_PROVIDER, type: credential.type }]
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== OPENAI_CODEX_PROVIDER) {
      throw new CredentialStoreError('UNSUPPORTED_PROVIDER', 'This credential store accepts only openai-codex.')
    }
    return this.withLock(async () => {
      const current = (await this.readEnvelope())?.credentials[OPENAI_CODEX_PROVIDER]
      const replacement = await fn(current === undefined ? undefined : cloneCredential(current))
      if (replacement === undefined) return current === undefined ? undefined : cloneCredential(current)
      const validated = parseCredential(replacement)
      await this.writeCredential(validated)
      return cloneCredential(validated)
    })
  }

  async delete(providerId: string): Promise<void> {
    if (providerId !== OPENAI_CODEX_PROVIDER) return
    await this.withLock(async () => {
      const info = await lstat(this.credentialFile).catch((error: unknown) => {
        if (isMissing(error)) return undefined
        throw error
      })
      if (info === undefined) return
      if (info.isSymbolicLink() || !info.isFile()) throw unsafePath()
      await unlink(this.credentialFile)
    })
  }
}
