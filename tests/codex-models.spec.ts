import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessageEvent, CodexContext, Model } from '../src/models.js'
import { CodexModels } from '../src/codex-models.js'
import { OPENAI_CODEX_PROVIDER } from '../src/credential-store.js'
import type { CredentialStore, OAuthCredential } from '../src/oauth-types.js'

const model: Model<'openai-codex-responses'> = {
  id: 'gpt-test-codex', name: 'GPT Test Codex', api: 'openai-codex-responses',
  provider: OPENAI_CODEX_PROVIDER, baseUrl: 'https://chatgpt.com/backend-api', reasoning: true,
  thinkingLevelMap: { low: 'low', high: 'high' }, input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 64_000,
}

function credential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    type: 'oauth', access: 'access-secret', refresh: 'refresh-secret', expires: 2_000_000,
    accountId: 'account-1', ...overrides,
  }
}

function store(initial: OAuthCredential | undefined): CredentialStore {
  let value = initial
  return {
    read: async () => value,
    list: async () => value === undefined ? [] : [{ providerId: OPENAI_CODEX_PROVIDER, type: 'oauth' }],
    modify: async (_provider, operation) => {
      const next = await operation(value)
      if (next !== undefined) value = next
      return value
    },
    delete: async () => { value = undefined },
  }
}

function sse(events: readonly object[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function collect(events: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const values: AssistantMessageEvent[] = []
  for await (const event of events) values.push(event)
  return values
}

describe('CodexModels', () => {
  it('serializes a fresh context and sends only plugin-owned OAuth headers', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = []
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return sse([{
        type: 'response.completed',
        response: { id: 'response-1', status: 'completed', usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } },
      }])
    })
    const models = new CodexModels(store(credential()), { fetch, now: () => 1_000, refresh: vi.fn() })
    const context: CodexContext = {
      systemPrompt: 'System instructions',
      messages: [
        { role: 'user', content: 'first', timestamp: 0 },
        {
          role: 'assistant', api: 'dsh-foreign', provider: OPENAI_CODEX_PROVIDER, model: model.id,
          content: [{ type: 'toolCall', id: 'call-1', name: 'search', arguments: { q: 'one' } }],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'toolUse', timestamp: 0,
        },
        {
          role: 'toolResult', toolCallId: 'call-1', toolName: 'search',
          content: [{ type: 'text', text: 'result' }], isError: false, timestamp: 0,
        },
      ],
      tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
    }

    await collect(models.streamSimple(model, context, {
      reasoning: 'high', temperature: 0.2,
      transformHeaders: headers => ({ ...headers, 'x-dsh-test': 'attribution' }),
    }))

    expect(requests[0]?.url).toBe('https://chatgpt.com/backend-api/codex/responses')
    const headers = new Headers(requests[0]?.init?.headers)
    expect(headers.get('authorization')).toBe('Bearer access-secret')
    expect(headers.get('chatgpt-account-id')).toBe('account-1')
    expect(headers.get('originator')).toBe('deepseek-harness')
    expect(headers.get('user-agent')).toBe('dsh-openai-oauth/0.1.0')
    expect(headers.get('x-dsh-test')).toBe('attribution')
    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: model.id, store: false, stream: true, instructions: 'System instructions',
      temperature: 0.2, reasoning: { effort: 'high', summary: 'auto' },
    })
    expect(body['tools']).toEqual([{
      type: 'function', name: 'search', description: 'Search', parameters: { type: 'object' }, strict: null,
    }])
    expect(body['input']).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'first' }] },
      { type: 'function_call', call_id: 'call-1', name: 'search', arguments: '{"q":"one"}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'result' },
    ])
  })

  it('maps reasoning, text, tool calls, usage, and terminal state from SSE', async () => {
    const fetch = vi.fn(async () => sse([
      { type: 'response.created', response: { id: 'response-1' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1' } },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'think' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [{ text: 'think' }], encrypted_content: 'encrypted' } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_1', content: [] } },
      { type: 'response.output_text.delta', output_index: 1, delta: 'answer' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: 'answer' }] } },
      { type: 'response.output_item.added', output_index: 2, item: { type: 'function_call', id: 'fc_1', call_id: 'call-7', name: 'search', arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{"q":"value"}' },
      { type: 'response.output_item.done', output_index: 2, item: { type: 'function_call', id: 'fc_1', call_id: 'call-7', name: 'search', arguments: '{"q":"value"}' } },
      { type: 'response.completed', response: {
        id: 'response-1', status: 'completed',
        usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18,
          input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
          output_tokens_details: { reasoning_tokens: 5 } },
      } },
    ]))
    const models = new CodexModels(store(credential()), { fetch, now: () => 1_000, refresh: vi.fn() })

    const events = await collect(models.streamSimple(model, { messages: [] }))

    expect(events).toContainEqual(expect.objectContaining({ type: 'thinking_delta', contentIndex: 0, delta: 'think' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'text_delta', contentIndex: 1, delta: 'answer' }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'toolcall_end', contentIndex: 2,
      toolCall: { type: 'toolCall', id: 'call-7|fc_1', name: 'search', arguments: { q: 'value' } },
    }))
    expect(events.at(-1)).toMatchObject({
      type: 'done', message: {
        responseId: 'response-1', stopReason: 'toolUse',
        usage: { input: 5, output: 8, cacheRead: 3, cacheWrite: 2, reasoning: 5, totalTokens: 18 },
      },
    })
  })

  it('refreshes an expiring credential once and redacts HTTP failures', async () => {
    const requests: RequestInit[] = []
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      return sse([{
        type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 0, output_tokens: 0 } },
      }])
    })
    const refresh = vi.fn(async () => credential({
      access: 'new-access', refresh: 'new-refresh', expires: 500_000, accountId: 'new-account',
    }))
    const models = new CodexModels(store(credential({ expires: 1 })), { fetch, now: () => 100_000, refresh })

    await collect(models.streamSimple(model, { messages: [] }))

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(new Headers(requests[0]?.headers).get('authorization')).toBe('Bearer new-access')

    const failed = new CodexModels(store(credential()), {
      fetch: vi.fn(async () => new Response('provider-secret', { status: 401 })),
      now: () => 1_000,
      refresh,
    })
    await expect(collect(failed.streamSimple(model, { messages: [] })))
      .rejects.toMatchObject({ code: 'AUTH', message: 'OpenAI Codex authentication failed. Sign in again.' })
  })

  it('requires a stored sign-in before starting a request', async () => {
    const models = new CodexModels(store(undefined), { fetch: vi.fn(), refresh: vi.fn() })
    await expect(collect(models.streamSimple(model, { messages: [] })))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('parses CRLF event separators split across network chunks', async () => {
    const encoder = new TextEncoder()
    const payload = JSON.stringify({
      type: 'response.completed',
      response: { status: 'completed', usage: { input_tokens: 0, output_tokens: 0 } },
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${payload}\r`))
        controller.enqueue(encoder.encode('\n\r'))
        controller.enqueue(encoder.encode('\n'))
        controller.close()
      },
    })
    const models = new CodexModels(store(credential()), {
      fetch: async () => new Response(body, { status: 200 }), refresh: vi.fn(), now: () => 1_000,
    })

    await expect(collect(models.streamSimple(model, { messages: [] })))
      .resolves.toContainEqual(expect.objectContaining({ type: 'done' }))
  })

  it('treats a terminal failed status as an error event', async () => {
    const models = new CodexModels(store(credential()), {
      fetch: async () => sse([{
        type: 'response.completed',
        response: { status: 'failed', usage: { input_tokens: 0, output_tokens: 0 } },
      }]),
      refresh: vi.fn(), now: () => 1_000,
    })

    await expect(collect(models.streamSimple(model, { messages: [] })))
      .resolves.toContainEqual(expect.objectContaining({ type: 'error', reason: 'error' }))
  })

  it('cancels an in-flight credential refresh with the caller request', async () => {
    const controller = new AbortController()
    let rejectRefresh!: (error: Error) => void
    let resolveStarted!: (signal: AbortSignal | undefined) => void
    const started = new Promise<AbortSignal | undefined>(resolve => { resolveStarted = resolve })
    const refresh = vi.fn((_credential: OAuthCredential, signal?: AbortSignal) => new Promise<OAuthCredential>((_resolve, reject) => {
      rejectRefresh = reject
      resolveStarted(signal)
    }))
    const models = new CodexModels(store(credential({ expires: 1 })), {
      fetch: vi.fn(), now: () => 100_000, refresh,
    })

    const running = collect(models.streamSimple(model, { messages: [] }, { signal: controller.signal }))
    await expect(started).resolves.toBe(controller.signal)
    controller.abort()
    rejectRefresh(new Error('upstream secret'))

    await expect(running).rejects.toMatchObject({ code: 'ABORTED' })
  })
})
