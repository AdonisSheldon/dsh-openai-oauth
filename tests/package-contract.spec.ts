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
  files?: string[]
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
    expect(value.files?.filter(path => path.startsWith('lib/'))).toEqual([
      'lib/client.d.ts',
      'lib/client.js',
      'lib/index.d.ts',
      'lib/index.js',
      'lib/login.d.ts',
      'lib/login.js',
      'lib/src.js',
    ])
  })

  it('installs only plugin-owned production dependencies', async () => {
    const value = await manifest()

    expect(value.dependencies).toEqual({
      'proper-lockfile': '4.1.2',
    })
    const forbidden = `@earendil-works/${['pi', 'ai'].join('-')}`
    expect(value.peerDependencies).not.toHaveProperty(forbidden)
    expect(value.devDependencies).not.toHaveProperty(forbidden)
  })

  it('ships runtime and declarations without the removed model library', async () => {
    const forbidden = `@earendil-works/${['pi', 'ai'].join('-')}`
    const published = await Promise.all([
      readFile(resolve(root, 'lib/index.js'), 'utf8'),
      readFile(resolve(root, 'lib/index.d.ts'), 'utf8'),
      readFile(resolve(root, 'lib/src.js'), 'utf8'),
    ])

    expect(published.join('\n')).not.toContain(forbidden)
  })

  it('declares every DSH-provided runtime as an optional exact peer', async () => {
    const value = await manifest()
    const hostPeers = Object.keys(value.peerDependencies ?? {})

    expect(hostPeers).not.toContain(`@earendil-works/${['pi', 'ai'].join('-')}`)
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
