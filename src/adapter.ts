/** OpenAI Codex adapter. No Codex App Server or external agent process is created. */
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { getSupportedThinkingLevels } from './models.js'
import type {
  Api,
  AssistantMessageEvent,
  CodexContext,
  Model,
  ModelsSimpleStreamOptions,
  ThinkingLevel,
} from './models.js'
import { toCodexContext } from './context.js'
import { OPENAI_CODEX_PROVIDER } from './credential-store.js'
import { redactedCodexError, toStreamChunks } from './stream.js'

/** Minimum model collection used by the route-specific adapter. */
export interface OpenAiCodexModels {
  getModels(provider?: string): readonly Model<Api>[]
  getModel(provider: string, id: string): Model<Api> | undefined
  streamSimple(
    model: Model<Api>,
    context: CodexContext,
    options?: ModelsSimpleStreamOptions,
  ): AsyncIterable<AssistantMessageEvent>
}

export interface OpenAiCodexAdapterOptions {
  /** Resolve the optional durable image service at request time. */
  attachments?: () => AttachmentStore | undefined
}

function assertProvider(provider: string): void {
  if (provider !== OPENAI_CODEX_PROVIDER) {
    throw new LlmError(`OpenAI Codex adapter does not own provider "${provider}"`, 'NO_ADAPTER')
  }
}

function modelInfo(model: Model<Api>): LlmModelInfo {
  return {
    provider: OPENAI_CODEX_PROVIDER,
    id: model.id,
    name: model.name,
    inputModalities: [...model.input],
  }
}

function reasoningLevels(model: Model<Api>): ThinkingLevel[] {
  return getSupportedThinkingLevels(model).filter((level): level is ThinkingLevel => level !== 'off')
}

function reasoningName(level: string): string {
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

function resolveReasoning(model: Model<Api>, requested: GenerateOptions['reasoningEffort']): ThinkingLevel | undefined {
  if (requested === undefined) return undefined
  const value = String(requested)
  const supported = reasoningLevels(model)
  if (supported.some(level => level === value)) return value as ThinkingLevel
  throw new LlmError(
    `OpenAI Codex model "${model.id}" does not support reasoning effort "${value}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

function transformHeaders(headers: Readonly<Record<string, string | null>>): Record<string, string | null> {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(headers).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  }
}

/** Route-specific adapter over the plugin-owned credential-aware model collection. */
export class OpenAiCodexAdapter extends LlmAdapter {
  /**
   * @param models - plugin-owned OpenAI Codex model collection.
   * @param options - optional Harness capability resolvers.
   */
  constructor(
    private readonly models: OpenAiCodexModels,
    private readonly options: OpenAiCodexAdapterOptions = {},
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    assertProvider(provider)
    return { id: provider, name: 'OpenAI Codex (ChatGPT OAuth)' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(() => {
      assertProvider(provider)
      return this.models.getModels(provider).map(modelInfo)
    })
  }

  override resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      assertProvider(provider)
      const model = this.models.getModel(provider, id)
      if (model === undefined) throw new LlmError(`OpenAI Codex has no model "${id}"`, 'UNKNOWN_MODEL')
      const levels = reasoningLevels(model)
      return {
        ...modelInfo(model),
        context: { contextWindow: model.contextWindow },
        ...levels.length === 0 ? {} : {
          reasoning: {
            efforts: levels.map(level => ({ id: ReasoningEffortId(level), name: reasoningName(level) })),
          },
        },
      }
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assertProvider(options.provider)
    if (options.stop !== undefined) {
      throw new LlmError('OpenAI Codex does not support Harness stop sequences.', 'UNSUPPORTED_OPTION')
    }
    if (options.maxTokens !== undefined) {
      throw new LlmError('OpenAI Codex does not expose a per-request maxTokens option.', 'UNSUPPORTED_OPTION')
    }
    const model = this.models.getModel(options.provider, options.model)
    if (model === undefined) throw new LlmError(`OpenAI Codex has no model "${options.model}"`, 'UNKNOWN_MODEL')
    const reasoning = resolveReasoning(model, options.reasoningEffort)
    const containsImage = options.messages.some(message => contentHasImage(message.content))
    if (containsImage && !model.input.includes('image')) {
      throw new LlmError(`OpenAI Codex model "${model.id}" does not support image input.`, 'UNSUPPORTED_CONTENT')
    }
    if (options.signal?.aborted) throw new LlmError('OpenAI Codex request was aborted by the caller.', 'ABORTED')

    const consumer = new AbortController()
    const signal = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    let iterator: AsyncIterator<StreamChunk> | undefined
    let exhausted = false
    try {
      const context = await toCodexContext(options, containsImage ? this.options.attachments?.() : undefined)
      const events = this.models.streamSimple(model, context, {
        ...reasoning === undefined ? {} : { reasoning },
        ...options.temperature === undefined ? {} : { temperature: options.temperature },
        ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
        signal,
        maxRetries: 0,
        transformHeaders,
      })
      iterator = toStreamChunks(events, model.contextWindow)[Symbol.asyncIterator]()
      while (true) {
        const next = await iterator.next()
        if (next.done) {
          exhausted = true
          return
        }
        yield next.value
      }
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (options.signal?.aborted) throw new LlmError('OpenAI Codex request was aborted by the caller.', 'ABORTED')
      throw redactedCodexError(error)
    } finally {
      if (!exhausted) {
        consumer.abort('OpenAI Codex stream consumer stopped')
        try {
          await iterator?.return?.()
        } catch {
          // The stable abort signal already owns teardown; return adds no outcome.
        }
      }
      consumer.abort('OpenAI Codex stream consumer stopped')
    }
  }
}
