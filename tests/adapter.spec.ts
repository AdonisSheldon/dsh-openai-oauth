import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId, MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  CodexContext,
  Model,
  ModelsSimpleStreamOptions,
} from '../src/models.js'
import { OpenAiCodexAdapter, type OpenAiCodexModels } from '../src/adapter.js'
import { OPENAI_CODEX_PROVIDER } from '../src/credential-store.js'

const model: Model<'openai-codex-responses'> = {
  id: 'gpt-test-codex',
  name: 'GPT Test Codex',
  api: 'openai-codex-responses',
  provider: OPENAI_CODEX_PROVIDER,
  baseUrl: 'https://chatgpt.com/backend-api',
  reasoning: true,
  thinkingLevelMap: {
    off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null,
  },
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 64_000,
}

function usage() {
  return {
    input: 10,
    output: 8,
    cacheRead: 3,
    cacheWrite: 2,
    reasoning: 5,
    totalTokens: 23,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-codex-responses',
    provider: OPENAI_CODEX_PROVIDER,
    model: model.id,
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
    ...overrides,
  }
}

function message(id: string, value: Omit<Message, 'id'>): Message {
  return { id: MessageId(id), ...value }
}

function options(messages: Message[]): GenerateOptions {
  return {
    provider: OPENAI_CODEX_PROVIDER,
    model: model.id,
    reasoningEffort: ReasoningEffortId('high'),
    messages,
    system: 'System instructions',
    tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
    temperature: 0.2,
  }
}

function fakeModels(events: AssistantMessageEvent[] = []): {
  models: OpenAiCodexModels
  streamSimple: ReturnType<typeof vi.fn>
} {
  const streamSimple = vi.fn((_model: Model<Api>, _context: CodexContext, _options?: ModelsSimpleStreamOptions) => (async function* () {
    for (const event of events) yield event
  })())
  return {
    models: {
      getModels: provider => provider === OPENAI_CODEX_PROVIDER ? [model] : [],
      getModel: (provider, id) => provider === OPENAI_CODEX_PROVIDER && id === model.id ? model : undefined,
      streamSimple,
    },
    streamSimple,
  }
}

async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const values: StreamChunk[] = []
  for await (const chunk of chunks) values.push(chunk)
  return values
}

describe('OpenAiCodexAdapter', () => {
  it('discovers only the owned route and resolves text/image plus supported reasoning metadata', async () => {
    const adapter = new OpenAiCodexAdapter(fakeModels().models)

    expect(adapter.providerInfo(OPENAI_CODEX_PROVIDER)).toEqual({
      id: OPENAI_CODEX_PROVIDER,
      name: 'OpenAI Codex (ChatGPT OAuth)',
    })
    expect(await adapter.listModels(OPENAI_CODEX_PROVIDER)).toEqual([{
      provider: OPENAI_CODEX_PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: ['text', 'image'],
    }])
    expect(await adapter.resolveModel(OPENAI_CODEX_PROVIDER, model.id)).toEqual({
      provider: OPENAI_CODEX_PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: ['text', 'image'],
      context: { contextWindow: 200_000 },
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      },
    })
    await expect(adapter.resolveModel('openai', model.id)).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel(OPENAI_CODEX_PROVIDER, 'missing')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
  })

  it('reconstructs each Codex request from the supplied Harness history and tools', async () => {
    const { models, streamSimple } = fakeModels([
      { type: 'done', reason: 'stop', message: assistant({ content: [{ type: 'text', text: 'ok' }] }) },
    ])
    const adapter = new OpenAiCodexAdapter(models)
    const history: Message[] = [
      message('user-1', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] }),
      message('assistant-1', {
        role: 'assistant',
        source: { kind: 'model', provider: OPENAI_CODEX_PROVIDER, model: model.id },
        content: [{ type: 'tool-call', id: CallId('call-1'), name: 'search', arguments: '{"q":"one"}' }],
      }),
      message('tool-1', {
        role: 'user', source: { kind: 'tool', callId: CallId('call-1') },
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'result' }] }],
      }),
      message('user-2', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] }),
    ]

    await collect(adapter.stream(options(history)))
    await collect(adapter.stream(options([history[3]!])) )

    const firstContext = streamSimple.mock.calls[0]![1] as CodexContext
    const secondContext = streamSimple.mock.calls[1]![1] as CodexContext
    expect(firstContext.systemPrompt).toBe('System instructions')
    expect(firstContext.tools).toEqual([{ name: 'search', description: 'Search', parameters: { type: 'object' } }])
    expect(firstContext.messages.map(entry => entry.role)).toEqual(['user', 'assistant', 'toolResult', 'user'])
    expect(firstContext.messages[2]).toMatchObject({ toolCallId: 'call-1', toolName: 'search', isError: false })
    expect(secondContext.messages).toEqual([{ role: 'user', content: 'second', timestamp: 0 }])
    expect(firstContext).not.toBe(secondContext)

    const streamOptions = streamSimple.mock.calls[0]![2] as ModelsSimpleStreamOptions
    expect(streamOptions).toMatchObject({ reasoning: 'high', temperature: 0.2, maxRetries: 0 })
    expect(streamOptions).not.toHaveProperty('apiKey')
    expect(streamOptions.transformHeaders?.({ authorization: 'secret', 'User-Agent': 'provider' }))
      .toMatchObject({ authorization: 'secret' })
  })

  it('maps text, reasoning, tool calls, usage, and finish without exposing provider failure details', async () => {
    const partial = assistant({
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '' },
        { type: 'toolCall', id: 'call-7', name: 'search', arguments: {} },
      ],
    })
    const done = assistant({
      content: [
        { type: 'thinking', thinking: 'think' },
        { type: 'text', text: 'answer' },
        { type: 'toolCall', id: 'call-7', name: 'search', arguments: { q: 'value' } },
      ],
      stopReason: 'toolUse',
      responseId: 'response-1',
    })
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial },
      { type: 'thinking_start', contentIndex: 0, partial },
      { type: 'thinking_delta', contentIndex: 0, delta: 'think', partial },
      { type: 'thinking_end', contentIndex: 0, content: 'think', partial },
      { type: 'text_start', contentIndex: 1, partial },
      { type: 'text_delta', contentIndex: 1, delta: 'answer', partial },
      { type: 'text_end', contentIndex: 1, content: 'answer', partial },
      { type: 'toolcall_start', contentIndex: 2, partial },
      { type: 'toolcall_delta', contentIndex: 2, delta: '{"q":"value"}', partial },
      { type: 'toolcall_end', contentIndex: 2, toolCall: done.content[2] as Extract<AssistantMessage['content'][number], { type: 'toolCall' }>, partial },
      { type: 'done', reason: 'toolUse', message: done },
    ]

    const chunks = await collect(new OpenAiCodexAdapter(fakeModels(events).models).stream(options([])))

    expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 0, text: 'think' })
    expect(chunks).toContainEqual({ type: 'text-delta', index: 1, text: 'answer' })
    expect(chunks).toContainEqual({
      type: 'block-end', index: 2,
      block: { type: 'tool-call', id: CallId('call-7'), name: 'search', arguments: '{"q":"value"}' },
    })
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 10, outputTokens: 8, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 5 },
    })
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'tool-calls' },
      replayState: { kind: 'openai-codex', version: 1, responseId: 'response-1' },
    })

    const upstreamSecret = 'provider-token-secret'
    const failed = assistant({ stopReason: 'error', errorMessage: `401 ${upstreamSecret}` })
    const failureChunks = await collect(new OpenAiCodexAdapter(fakeModels([
      { type: 'error', reason: 'error', error: failed },
    ]).models).stream(options([])))
    expect(failureChunks.at(-1)).toEqual({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'AUTH', message: 'OpenAI Codex authentication failed. Sign in again.' } },
    })
    expect(JSON.stringify(failureChunks)).not.toContain(upstreamSecret)
  })

  it('rejects silently unsupported options, content, and reasoning before dispatch', async () => {
    const { models, streamSimple } = fakeModels()
    const adapter = new OpenAiCodexAdapter(models)

    await expect(collect(adapter.stream({ ...options([]), stop: ['END'] })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    await expect(collect(adapter.stream({ ...options([]), maxTokens: 100 })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    await expect(collect(adapter.stream({ ...options([]), reasoningEffort: ReasoningEffortId('off') })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    const textModel = { ...model, input: ['text'] as ('text' | 'image')[] }
    const textOnly: OpenAiCodexModels = {
      ...models,
      getModels: () => [textModel],
      getModel: () => textModel,
    }
    const imageMessage = message('image', {
      role: 'user', source: { kind: 'user' },
      content: [{
        type: 'image',
        attachment: { attachmentId: AttachmentId('image-1'), mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      }],
    })
    await expect(collect(new OpenAiCodexAdapter(textOnly).stream(options([imageMessage]))))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(streamSimple).not.toHaveBeenCalled()
  })

  it('maps caller aborts to the published adapter failure', async () => {
    const controller = new AbortController()
    const streamSimple = vi.fn((_model: Model<Api>, _context: CodexContext, options?: ModelsSimpleStreamOptions) => (async function* () {
      controller.abort('stop')
      options?.signal?.throwIfAborted()
      yield { type: 'start', partial: assistant() } satisfies AssistantMessageEvent
    })())
    const models: OpenAiCodexModels = {
      getModels: () => [model],
      getModel: () => model,
      streamSimple,
    }

    await expect(collect(new OpenAiCodexAdapter(models).stream({ ...options([]), signal: controller.signal })))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })
})
