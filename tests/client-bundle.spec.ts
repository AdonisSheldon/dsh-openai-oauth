import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface ClientPluginHandoff {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

describe('published client bundle', () => {
  it('registers a DSH module-loader factory under the package name', async () => {
    const handoffs: ClientPluginHandoff[] = []
    const window = {
      __ModuleLoader__: {
        load: (handoff: ClientPluginHandoff): void => { handoffs.push(handoff) },
      },
    }

    runInNewContext(readFileSync(resolve('lib/client.js'), 'utf8'), { window })

    expect(handoffs).toHaveLength(1)
    const handoff = handoffs[0]
    expect(handoff?.id).toBe('dsh-openai-oauth')

    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
      ['@deepseek-ai/dsh-client-ui-primitives', { Button: () => null }],
    ])
    const exports = handoff?.factory((specifier) => {
      if (!modules.has(specifier)) throw new Error(`Unexpected client external: ${specifier}`)
      return modules.get(specifier)
    })

    expect(exports?.['apply']).toBeTypeOf('function')
    expect(exports?.['inject']).toEqual(['slots', 'locale'])
  })
})
