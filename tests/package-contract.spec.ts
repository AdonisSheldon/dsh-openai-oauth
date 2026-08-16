import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  name?: string
  bin?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  scripts?: Record<string, string>
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function manifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as PackageManifest
}

describe('published package contract', () => {
  it('publishes only the dsh-openai-oauth package and CLI identities', async () => {
    const value = await manifest()

    expect(value.name).toBe('dsh-openai-oauth')
    expect(value.bin).toEqual({ 'dsh-openai-login': 'lib/login.js' })
  })

  it('installs only plugin-owned production dependencies', async () => {
    const value = await manifest()

    expect(value.dependencies).toEqual({
      'proper-lockfile': '4.1.2',
    })
    expect(value.peerDependencies?.['@earendil-works/pi-ai']).toBe('0.82.1')
    expect(value.devDependencies?.['@earendil-works/pi-ai']).toBe('0.82.1')
  })

  it('declares every DSH-provided runtime as an optional exact peer', async () => {
    const value = await manifest()
    const hostPeers = Object.keys(value.peerDependencies ?? {})

    expect(hostPeers).toContain('@earendil-works/pi-ai')
    expect(hostPeers.length).toBeGreaterThan(0)
    for (const name of hostPeers) {
      expect(value.peerDependencies?.[name]).not.toMatch(/[~^*xX]|\|\||\s-\s/)
      expect(value.peerDependenciesMeta?.[name]).toEqual({ optional: true })
    }
  })

  it('does not run package-manager lifecycle hooks during installation', async () => {
    const value = await manifest()

    for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(value.scripts?.[name]).toBeUndefined()
    }
  })
})
