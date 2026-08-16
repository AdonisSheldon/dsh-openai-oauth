import { LlmError } from '@deepseek-ai/dsh-llm'
import { OPENAI_CODEX_PROVIDER } from './credential-store.js'
import { OPENAI_CODEX_MODELS } from './models.js'
import type {
  AssistantMessage,
  AssistantMessageEvent,
  CodexContext,
  ImageContent,
  Model,
  ModelsSimpleStreamOptions,
  TextContent,
  ToolCallContent,
  Usage,
} from './models.js'
import type { CredentialStore, OAuthCredential } from './oauth-types.js'

const REFRESH_SKEW_MS = 60_000
const RESPONSES_PATH = '/codex/responses'
const MAX_SSE_BUFFER_CHARS = 16 * 1024 * 1024

type CodexFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface CodexModelsOptions {
  fetch?: CodexFetch
  now?: () => number
  refresh: (credential: OAuthCredential, signal?: AbortSignal) => Promise<OAuthCredential>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function emptyUsage(): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function outputMessage(model: Model): AssistantMessage {
  return {
    role: 'assistant', content: [], api: 'openai-codex-responses',
    provider: OPENAI_CODEX_PROVIDER, model: model.id,
    usage: emptyUsage(), stopReason: 'stop', timestamp: Date.now(),
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parsedSignature(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function resultOutput(content: readonly (TextContent | ImageContent)[]): unknown {
  const text = content.filter((block): block is TextContent => block.type === 'text')
    .map(block => block.text).join('')
  const images = content.filter((block): block is ImageContent => block.type === 'image')
  if (images.length === 0) return text || '(no output)'
  return [
    ...text.length === 0 ? [] : [{ type: 'input_text', text }],
    ...images.map(image => ({
      type: 'input_image', detail: 'auto', image_url: `data:${image.mimeType};base64,${image.data}`,
    })),
  ]
}

function inputOf(context: CodexContext): unknown[] {
  const input: unknown[] = []
  for (const [messageIndex, message] of context.messages.entries()) {
    if (message.role === 'user') {
      const content = typeof message.content === 'string'
        ? [{ type: 'input_text', text: message.content }]
        : message.content.map(block => block.type === 'text'
          ? { type: 'input_text', text: block.text }
          : { type: 'input_image', detail: 'auto', image_url: `data:${block.mimeType};base64,${block.data}` })
      if (content.length > 0) input.push({ role: 'user', content })
      continue
    }
    if (message.role === 'toolResult') {
      input.push({
        type: 'function_call_output', call_id: message.toolCallId.split('|', 1)[0],
        output: resultOutput(message.content),
      })
      continue
    }
    for (const [blockIndex, block] of message.content.entries()) {
      if (block.type === 'thinking') {
        const native = parsedSignature(block.thinkingSignature)
        if (native?.['type'] === 'reasoning') input.push(native)
        continue
      }
      if (block.type === 'text') {
        const signature = parsedSignature(block.textSignature)
        input.push({
          type: 'message', role: 'assistant', status: 'completed',
          id: stringOf(signature?.['id']) ?? `msg_dsh_${messageIndex}_${blockIndex}`,
          content: [{ type: 'output_text', text: block.text, annotations: [] }],
          ...stringOf(signature?.['phase']) === undefined ? {} : { phase: stringOf(signature?.['phase']) },
        })
        continue
      }
      const [callId = '', itemId] = block.id.split('|', 2)
      input.push({
        type: 'function_call',
        ...itemId === undefined || itemId.length === 0 ? {} : { id: itemId },
        call_id: callId, name: block.name, arguments: JSON.stringify(block.arguments),
      })
    }
  }
  return input
}

function requestBody(model: Model, context: CodexContext, options: ModelsSimpleStreamOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.id,
    store: false,
    stream: true,
    instructions: context.systemPrompt || 'You are a helpful assistant.',
    input: inputOf(context),
    text: { verbosity: 'low' },
    include: ['reasoning.encrypted_content'],
    tool_choice: 'auto',
    parallel_tool_calls: true,
  }
  if (options.sessionId !== undefined) body['prompt_cache_key'] = options.sessionId
  if (options.temperature !== undefined) body['temperature'] = options.temperature
  if (context.tools !== undefined && context.tools.length > 0) {
    body['tools'] = context.tools.map(tool => ({
      type: 'function', name: tool.name, description: tool.description,
      parameters: tool.parameters, strict: null,
    }))
  }
  if (options.reasoning !== undefined && options.reasoning !== 'off') {
    const effort = model.thinkingLevelMap?.[options.reasoning] ?? options.reasoning
    if (effort !== null) body['reasoning'] = { effort, summary: 'auto' }
  }
  return body
}

function requestHeaders(credential: OAuthCredential, options: ModelsSimpleStreamOptions): Headers {
  const required: Record<string, string> = {
    authorization: `Bearer ${credential.access}`,
    'chatgpt-account-id': credential.accountId,
    originator: 'deepseek-harness',
    'user-agent': 'dsh-openai-oauth/0.1.0',
    'openai-beta': 'responses=experimental',
    accept: 'text/event-stream',
    'content-type': 'application/json',
  }
  const transformed = options.transformHeaders?.({}) ?? {}
  const headers = new Headers()
  for (const [name, value] of Object.entries(transformed)) {
    if (value !== null) headers.set(name, value)
  }
  for (const [name, value] of Object.entries(required)) headers.set(name, value)
  if (options.sessionId !== undefined) {
    headers.set('session-id', options.sessionId)
    headers.set('x-client-request-id', options.sessionId)
  }
  return headers
}

function httpFailure(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError('OpenAI Codex authentication failed. Sign in again.', 'AUTH')
  }
  if (status === 429) return new LlmError('OpenAI Codex rate limit reached. Retry later.', 'RATE_LIMIT')
  if (status === 408 || status === 504) return new LlmError('OpenAI Codex request timed out.', 'TIMEOUT')
  return new LlmError('OpenAI Codex request failed.', 'CODEX_ERROR')
}

async function* sse(response: Response, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  if (response.body === null) throw new LlmError('OpenAI Codex returned no response body.', 'TRANSPORT')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const abort = (): void => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw new LlmError('OpenAI Codex request was aborted.', 'ABORTED')
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      if (buffer.length > MAX_SSE_BUFFER_CHARS) {
        throw new LlmError('OpenAI Codex returned an oversized streaming event.', 'PROTOCOL_ERROR')
      }
      let separator = /\r?\n\r?\n/.exec(buffer)
      while (separator !== null) {
        const frame = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart()).join('\n').trim()
        if (data.length > 0 && data !== '[DONE]') {
          let parsed: unknown
          try {
            parsed = JSON.parse(data)
          } catch {
            throw new LlmError('OpenAI Codex returned invalid streaming data.', 'PROTOCOL_ERROR')
          }
          if (!isRecord(parsed)) throw new LlmError('OpenAI Codex returned invalid streaming data.', 'PROTOCOL_ERROR')
          yield parsed
        }
        separator = /\r?\n\r?\n/.exec(buffer)
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function responseUsage(value: unknown): Usage {
  if (!isRecord(value)) return emptyUsage()
  const input = numberOf(value['input_tokens']) ?? 0
  const output = numberOf(value['output_tokens']) ?? 0
  const details = isRecord(value['input_tokens_details']) ? value['input_tokens_details'] : undefined
  const outputDetails = isRecord(value['output_tokens_details']) ? value['output_tokens_details'] : undefined
  const cacheRead = numberOf(details?.['cached_tokens']) ?? 0
  const cacheWrite = numberOf(details?.['cache_write_tokens']) ?? 0
  const reasoning = numberOf(outputDetails?.['reasoning_tokens']) ?? 0
  return {
    input: Math.max(0, input - cacheRead - cacheWrite), output, cacheRead, cacheWrite,
    ...(reasoning === 0 ? {} : { reasoning }),
    totalTokens: numberOf(value['total_tokens']) ?? input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

type Slot = { kind: 'thinking' | 'text' | 'toolCall'; contentIndex: number; arguments: string }

/** Credential-aware model collection and direct Codex Responses transport. */
export class CodexModels {
  private readonly fetch: CodexFetch
  private readonly now: () => number

  /**
   * @param credentials - plugin-owned credential persistence.
   * @param options - direct HTTP and refresh operations.
   */
  constructor(
    private readonly credentials: CredentialStore,
    private readonly options: CodexModelsOptions,
  ) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  /** Return models from the plugin's versioned catalog. */
  getModels(provider?: string): readonly Model[] {
    return provider === undefined || provider === OPENAI_CODEX_PROVIDER ? OPENAI_CODEX_MODELS : []
  }

  /** Resolve one exact model owned by the provider route. */
  getModel(provider: string, id: string): Model | undefined {
    return provider === OPENAI_CODEX_PROVIDER ? OPENAI_CODEX_MODELS.find(model => model.id === id) : undefined
  }

  private async credential(signal?: AbortSignal): Promise<OAuthCredential> {
    const current = await this.credentials.read(OPENAI_CODEX_PROVIDER)
    if (current === undefined) {
      throw new LlmError('OpenAI Codex is not signed in. Sign in with Browser or Device Code.', 'MISSING_CREDENTIAL')
    }
    if (current.expires > this.now() + REFRESH_SKEW_MS) return current
    const refreshed = await this.credentials.modify(OPENAI_CODEX_PROVIDER, async latest => {
      if (latest === undefined) {
        throw new LlmError('OpenAI Codex is not signed in. Sign in with Browser or Device Code.', 'MISSING_CREDENTIAL')
      }
      if (latest.expires > this.now() + REFRESH_SKEW_MS) return latest
      try {
        return await this.options.refresh(latest, signal)
      } catch {
        if (signal?.aborted) throw new LlmError('OpenAI Codex request was aborted.', 'ABORTED')
        throw new LlmError('OpenAI Codex authentication failed. Sign in again.', 'AUTH')
      }
    })
    if (refreshed === undefined) {
      throw new LlmError('OpenAI Codex is not signed in. Sign in with Browser or Device Code.', 'MISSING_CREDENTIAL')
    }
    return refreshed
  }

  /** Stream one request through the ChatGPT Codex Responses endpoint. */
  async * streamSimple(
    model: Model,
    context: CodexContext,
    options: ModelsSimpleStreamOptions = {},
  ): AsyncGenerator<AssistantMessageEvent> {
    const credential = await this.credential(options.signal)
    const response = await this.fetch(`${model.baseUrl.replace(/\/$/, '')}${RESPONSES_PATH}`, {
      method: 'POST', headers: requestHeaders(credential, options),
      body: JSON.stringify(requestBody(model, context, options)),
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
    if (!response.ok) throw httpFailure(response.status)

    const output = outputMessage(model)
    const slots = new Map<number, Slot>()
    yield { type: 'start', partial: output }
    for await (const event of sse(response, options.signal)) {
      const type = stringOf(event['type'])
      const outputIndex = numberOf(event['output_index'])
      const item = isRecord(event['item']) ? event['item'] : undefined
      if (type === 'response.created') {
        const responseValue = isRecord(event['response']) ? event['response'] : undefined
        const id = stringOf(responseValue?.['id'])
        if (id !== undefined) output.responseId = id
      } else if (type === 'response.output_item.added' && outputIndex !== undefined && item !== undefined) {
        const itemType = stringOf(item['type'])
        const contentIndex = output.content.length
        if (itemType === 'reasoning') {
          output.content.push({ type: 'thinking', thinking: '' })
          slots.set(outputIndex, { kind: 'thinking', contentIndex, arguments: '' })
          yield { type: 'thinking_start', contentIndex, partial: output }
        } else if (itemType === 'message') {
          output.content.push({ type: 'text', text: '' })
          slots.set(outputIndex, { kind: 'text', contentIndex, arguments: '' })
          yield { type: 'text_start', contentIndex, partial: output }
        } else if (itemType === 'function_call') {
          const block: ToolCallContent = {
            type: 'toolCall', id: `${stringOf(item['call_id']) ?? ''}|${stringOf(item['id']) ?? ''}`,
            name: stringOf(item['name']) ?? '', arguments: {},
          }
          output.content.push(block)
          slots.set(outputIndex, {
            kind: 'toolCall', contentIndex, arguments: stringOf(item['arguments']) ?? '',
          })
          yield { type: 'toolcall_start', contentIndex, partial: output }
        }
      } else if ((type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta')
        && outputIndex !== undefined) {
        const slot = slots.get(outputIndex)
        const delta = stringOf(event['delta']) ?? ''
        const block = slot === undefined ? undefined : output.content[slot.contentIndex]
        if (slot?.kind === 'thinking' && block?.type === 'thinking') {
          block.thinking += delta
          yield { type: 'thinking_delta', contentIndex: slot.contentIndex, delta, partial: output }
        }
      } else if ((type === 'response.output_text.delta' || type === 'response.refusal.delta')
        && outputIndex !== undefined) {
        const slot = slots.get(outputIndex)
        const delta = stringOf(event['delta']) ?? ''
        const block = slot === undefined ? undefined : output.content[slot.contentIndex]
        if (slot?.kind === 'text' && block?.type === 'text') {
          block.text += delta
          yield { type: 'text_delta', contentIndex: slot.contentIndex, delta, partial: output }
        }
      } else if (type === 'response.function_call_arguments.delta' && outputIndex !== undefined) {
        const slot = slots.get(outputIndex)
        const delta = stringOf(event['delta']) ?? ''
        if (slot?.kind === 'toolCall') {
          slot.arguments += delta
          yield { type: 'toolcall_delta', contentIndex: slot.contentIndex, delta, partial: output }
        }
      } else if (type === 'response.output_item.done' && outputIndex !== undefined && item !== undefined) {
        const slot = slots.get(outputIndex)
        const block = slot === undefined ? undefined : output.content[slot.contentIndex]
        if (slot?.kind === 'thinking' && block?.type === 'thinking') {
          const summary = Array.isArray(item['summary']) ? item['summary'] : []
          const text = summary.map(part => isRecord(part) ? stringOf(part['text']) ?? '' : '').join('\n\n')
          if (text.length > 0) block.thinking = text
          block.thinkingSignature = JSON.stringify(item)
          yield { type: 'thinking_end', contentIndex: slot.contentIndex, content: block.thinking, partial: output }
        } else if (slot?.kind === 'text' && block?.type === 'text') {
          const content = Array.isArray(item['content']) ? item['content'] : []
          const text = content.map(part => isRecord(part)
            ? stringOf(part['text']) ?? stringOf(part['refusal']) ?? '' : '').join('')
          if (text.length > 0) block.text = text
          block.textSignature = JSON.stringify({ id: stringOf(item['id']), phase: stringOf(item['phase']) })
          yield { type: 'text_end', contentIndex: slot.contentIndex, content: block.text, partial: output }
        } else if (slot?.kind === 'toolCall' && block?.type === 'toolCall') {
          const argumentsText = stringOf(item['arguments']) ?? (slot.arguments || '{}')
          block.id = `${stringOf(item['call_id']) ?? block.id.split('|', 1)[0]}|${stringOf(item['id']) ?? ''}`
          block.name = stringOf(item['name']) ?? block.name
          block.arguments = parseObject(argumentsText)
          yield { type: 'toolcall_end', contentIndex: slot.contentIndex, toolCall: block, partial: output }
        }
        slots.delete(outputIndex)
      } else if (type === 'response.completed' || type === 'response.done' || type === 'response.incomplete') {
        const terminal = isRecord(event['response']) ? event['response'] : {}
        const responseId = stringOf(terminal['id'])
        if (responseId !== undefined) output.responseId = responseId
        const responseModel = stringOf(terminal['model'])
        if (responseModel !== undefined) output.responseModel = responseModel
        output.usage = responseUsage(terminal['usage'])
        const status = stringOf(terminal['status'])
        if (status === 'failed' || status === 'cancelled') {
          output.stopReason = 'error'
          output.errorMessage = 'OpenAI Codex response failed.'
          yield { type: 'error', reason: 'error', error: output }
          return
        }
        output.stopReason = status === 'incomplete' || type === 'response.incomplete'
          ? 'length'
          : output.content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop'
        yield { type: 'done', reason: output.stopReason, message: output }
        return
      } else if (type === 'response.failed' || type === 'error') {
        output.stopReason = 'error'
        output.errorMessage = 'OpenAI Codex response failed.'
        yield { type: 'error', reason: 'error', error: output }
        return
      }
    }
    throw new LlmError('OpenAI Codex event stream closed without a terminal event.', 'STREAM_CLOSED')
  }
}
