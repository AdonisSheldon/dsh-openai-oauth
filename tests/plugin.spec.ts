import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Plugin from '../src/index.js'
import { OAUTH_ROUTE_PATH } from '../src/oauth-http.js'

const contexts: Context[] = []
const homes: string[] = []

async function home(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-openai-codex-oauth-plugin-'))
  homes.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  const { rm } = await import('node:fs/promises')
  await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true })))
  vi.unstubAllEnvs()
})

describe('standalone plugin lifecycle', () => {
  it('registers openai-codex in a headless Cordis tree and withdraws it on disposal', async () => {
    vi.stubEnv('DSH_HOME', await home())
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)

    const fiber = await ctx.plugin(Plugin)

    expect(ctx.llm.listProviders()).toEqual([{
      id: 'openai-codex',
      name: 'OpenAI Codex (ChatGPT OAuth)',
    }])
    expect((await ctx.llm.listModels('openai-codex')).length).toBeGreaterThan(0)

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('registers and removes the local Web route through the same plugin fiber', async () => {
    vi.stubEnv('DSH_HOME', await home())
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const fiber = await ctx.plugin(Plugin)
    const origin = `http://127.0.0.1:${ctx.webServer.port}`

    const live = await fetch(`${origin}${OAUTH_ROUTE_PATH}/status`)
    expect(live.status).toBe(200)
    expect(await live.json()).toMatchObject({ state: 'disconnected' })

    await fiber.dispose()
    expect((await fetch(`${origin}${OAUTH_ROUTE_PATH}/status`)).status).toBe(404)
  })

  it('refuses a Web Host bound to all interfaces', () => {
    expect(() => Plugin.assertLocalWebHost('0.0.0.0')).toThrow(/loopback/)
    expect(() => Plugin.assertLocalWebHost('127.0.0.1')).not.toThrow()
  })
})
