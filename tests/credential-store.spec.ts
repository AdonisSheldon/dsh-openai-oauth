import { chmod, lstat, mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { OPENAI_CODEX_PROVIDER, SecureCredentialStore } from '../src/credential-store.js'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-openai-oauth-store-'))
  roots.push(value)
  return value
}

function credential(suffix = 'one'): OAuthCredential {
  return {
    type: 'oauth',
    access: `access-${suffix}`,
    refresh: `refresh-${suffix}`,
    expires: 2_000_000_000_000,
    accountId: `account-${suffix}`,
  }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('SecureCredentialStore', () => {
  it('creates an owner-only directory and atomically persists an owner-only envelope', async () => {
    const home = await root()
    const store = new SecureCredentialStore(home)

    await store.modify(OPENAI_CODEX_PROVIDER, async () => credential())

    expect(store.stateDirectory).toBe(join(home, 'plugins', 'dsh-openai-oauth'))
    expect((await stat(store.stateDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(store.credentialFile)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(store.credentialFile, 'utf8'))).toEqual({
      version: 1,
      credentials: { [OPENAI_CODEX_PROVIDER]: credential() },
    })
    expect(await store.list()).toEqual([{ providerId: OPENAI_CODEX_PROVIDER, type: 'oauth' }])
    expect(await store.read(OPENAI_CODEX_PROVIDER)).toEqual(credential())
  })

  it('rejects a symbolic-link state directory and credential file', async () => {
    const home = await root()
    const outside = await root()
    await mkdir(join(home, 'plugins'), { recursive: true })
    await symlink(outside, join(home, 'plugins', 'dsh-openai-oauth'))

    await expect(new SecureCredentialStore(home).read(OPENAI_CODEX_PROVIDER))
      .rejects.toMatchObject({ code: 'UNSAFE_CREDENTIAL_PATH' })

    const safeHome = await root()
    const safeStore = new SecureCredentialStore(safeHome)
    await mkdir(safeStore.stateDirectory, { recursive: true, mode: 0o700 })
    await symlink(join(outside, 'credentials.json'), safeStore.credentialFile)
    await expect(safeStore.read(OPENAI_CODEX_PROVIDER))
      .rejects.toMatchObject({ code: 'UNSAFE_CREDENTIAL_PATH' })
  })

  it('fails closed with a redacted error for corrupt or over-permissive credentials', async () => {
    const home = await root()
    const store = new SecureCredentialStore(home)
    await mkdir(store.stateDirectory, { recursive: true, mode: 0o700 })
    const secret = 'secret-that-must-not-leak'
    await writeFile(store.credentialFile, `{ "access": "${secret}" }`, { mode: 0o600 })

    await expect(store.read(OPENAI_CODEX_PROVIDER)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIAL_FILE',
      message: 'OpenAI Codex credential file is invalid; log out or remove the plugin credential file and sign in again.',
    })
    await expect(store.read(OPENAI_CODEX_PROVIDER)).rejects.not.toThrow(secret)

    await writeFile(store.credentialFile, JSON.stringify({
      version: 1,
      credentials: { [OPENAI_CODEX_PROVIDER]: credential() },
    }), { mode: 0o600 })
    await chmod(store.credentialFile, 0o644)
    await expect(store.read(OPENAI_CODEX_PROVIDER))
      .rejects.toMatchObject({ code: 'UNSAFE_CREDENTIAL_PERMISSIONS' })
  })

  it('serializes read-modify-write across store instances without stale overwrite', async () => {
    const home = await root()
    const first = new SecureCredentialStore(home)
    const second = new SecureCredentialStore(home)
    let entered!: () => void
    let release!: () => void
    const hasEntered = new Promise<void>(resolve => { entered = resolve })
    const canFinish = new Promise<void>(resolve => { release = resolve })

    const firstWrite = first.modify(OPENAI_CODEX_PROVIDER, async () => {
      entered()
      await canFinish
      return credential('first')
    })
    await hasEntered
    const secondWrite = second.modify(OPENAI_CODEX_PROVIDER, async (current) => {
      expect(current).toEqual(credential('first'))
      return credential('second')
    })
    release()
    await Promise.all([firstWrite, secondWrite])

    expect(await first.read(OPENAI_CODEX_PROVIDER)).toEqual(credential('second'))
  })

  it('keeps the previous credential when a modifier fails or returns undefined', async () => {
    const home = await root()
    const store = new SecureCredentialStore(home)
    await store.modify(OPENAI_CODEX_PROVIDER, async () => credential())

    await expect(store.modify(OPENAI_CODEX_PROVIDER, async () => {
      throw new Error('replacement failed')
    })).rejects.toThrow('replacement failed')
    await store.modify(OPENAI_CODEX_PROVIDER, async () => undefined)

    expect(await store.read(OPENAI_CODEX_PROVIDER)).toEqual(credential())
    expect((await lstat(store.credentialFile)).isFile()).toBe(true)
  })

  it('serializes logout and removes only the plugin credential', async () => {
    const home = await root()
    const store = new SecureCredentialStore(home)
    await store.modify(OPENAI_CODEX_PROVIDER, async () => credential())

    await store.delete(OPENAI_CODEX_PROVIDER)

    expect(await store.read(OPENAI_CODEX_PROVIDER)).toBeUndefined()
    expect(await store.read('another-provider')).toBeUndefined()
    await expect(lstat(store.credentialFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
