/**
 * Lossless pi-ai assistant replay derived from the MIT-licensed
 * `@deepseek-ai/dsh-llm-pi-ai` implementation.
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Message, ModelMessageSource } from '@deepseek-ai/dsh-llm'
import type { Api, AssistantMessage, Usage as PiUsage } from '@earendil-works/pi-ai'

type ReplayBlock =
  | { type: 'text'; textSignature?: string }
  | { type: 'reasoning'; thinkingSignature?: string; redacted?: boolean }
  | { type: 'tool-call'; thoughtSignature?: string }

/** Minimal provider-native metadata required to replay a completed response. */
export interface PiAiReplayState {
  kind: 'pi-ai'
  version: 1
  api: Api
  provider: string
  model: string
  responseModel?: string
  responseId?: string
  stopReason: AssistantMessage['stopReason']
  blocks: ReplayBlock[]
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // A malformed historical model call remains representable as an empty object.
  }
  return {}
}

function emptyUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/** Project a completed pi-ai response into durable JSON replay metadata. */
export function toPiReplayState(message: AssistantMessage): PiAiReplayState {
  return {
    kind: 'pi-ai',
    version: 1,
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...message.responseModel === undefined ? {} : { responseModel: message.responseModel },
    ...message.responseId === undefined ? {} : { responseId: message.responseId },
    stopReason: message.stopReason,
    blocks: message.content.map((block): ReplayBlock => {
      switch (block.type) {
        case 'text': return {
          type: 'text',
          ...block.textSignature === undefined ? {} : { textSignature: block.textSignature },
        }
        case 'thinking': return {
          type: 'reasoning',
          ...block.thinkingSignature === undefined ? {} : { thinkingSignature: block.thinkingSignature },
          ...block.redacted === undefined ? {} : { redacted: block.redacted },
        }
        case 'toolCall': return {
          type: 'tool-call',
          ...block.thoughtSignature === undefined ? {} : { thoughtSignature: block.thoughtSignature },
        }
      }
    }),
  }
}

function invalidReplay(message: string): never {
  throw new LlmError(`invalid OpenAI Codex replay state: ${message}`, 'INVALID_REPLAY_STATE')
}

function readReplayState(value: unknown): PiAiReplayState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay('expected an object')
  const state = value as Record<string, unknown>
  if (state['kind'] !== 'pi-ai' || state['version'] !== 1) return invalidReplay('unsupported kind or version')
  for (const key of ['api', 'provider', 'model'] as const) {
    if (typeof state[key] !== 'string' || state[key].length === 0) return invalidReplay(`${key} must be a non-empty string`)
  }
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(state['stopReason']))) {
    return invalidReplay('unknown stop reason')
  }
  if (state['responseModel'] !== undefined && typeof state['responseModel'] !== 'string') return invalidReplay('responseModel must be a string')
  if (state['responseId'] !== undefined && typeof state['responseId'] !== 'string') return invalidReplay('responseId must be a string')
  if (!Array.isArray(state['blocks'])) return invalidReplay('blocks must be an array')
  for (const [index, value] of state['blocks'].entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay(`block ${index} must be an object`)
    const block = value as Record<string, unknown>
    if (!['text', 'reasoning', 'tool-call'].includes(String(block['type']))) return invalidReplay(`block ${index} has an unknown type`)
    for (const field of ['textSignature', 'thinkingSignature', 'thoughtSignature'] as const) {
      if (block[field] !== undefined && typeof block[field] !== 'string') return invalidReplay(`block ${index} ${field} must be a string`)
    }
    if (block['redacted'] !== undefined && typeof block['redacted'] !== 'boolean') return invalidReplay(`block ${index} redacted must be boolean`)
  }
  return state as unknown as PiAiReplayState
}

function foreignAssistant(message: Message): AssistantMessage {
  const source = message.source.kind === 'model' ? message.source : undefined
  const content: AssistantMessage['content'] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text': content.push({ type: 'text', text: block.text }); break
      case 'reasoning': content.push({ type: 'thinking', thinking: block.text }); break
      case 'tool-call': content.push({
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
      }); break
      default:
        throw new LlmError(`OpenAI Codex cannot replay assistant content type "${block.type}"`, 'UNSUPPORTED_CONTENT')
    }
  }
  return {
    role: 'assistant',
    content,
    api: 'dsh-foreign',
    provider: source?.provider ?? 'dsh-foreign',
    model: source?.model ?? 'dsh-foreign',
    usage: emptyUsage(),
    stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

function replayedAssistant(message: Message, source: ModelMessageSource, raw: unknown): AssistantMessage {
  const state = readReplayState(raw)
  if (state.provider !== source.provider || state.model !== source.model) return invalidReplay('provider or model does not match source')
  if (state.blocks.length !== message.content.length) return invalidReplay('block count does not match content')
  const content: AssistantMessage['content'] = message.content.map((block, index) => {
    const replay = state.blocks[index]
    if (replay === undefined || replay.type !== block.type) return invalidReplay(`block ${index} does not match content`)
    switch (block.type) {
      case 'text': return {
        type: 'text', text: block.text,
        ...replay.type === 'text' && replay.textSignature !== undefined ? { textSignature: replay.textSignature } : {},
      }
      case 'reasoning': return {
        type: 'thinking', thinking: block.text,
        ...replay.type === 'reasoning' && replay.thinkingSignature !== undefined ? { thinkingSignature: replay.thinkingSignature } : {},
        ...replay.type === 'reasoning' && replay.redacted !== undefined ? { redacted: replay.redacted } : {},
      }
      case 'tool-call': return {
        type: 'toolCall', id: block.id, name: block.name, arguments: parseArguments(block.arguments),
        ...replay.type === 'tool-call' && replay.thoughtSignature !== undefined ? { thoughtSignature: replay.thoughtSignature } : {},
      }
      default: return invalidReplay(`block ${index} has unsupported content`)
    }
  })
  return {
    role: 'assistant',
    content,
    api: state.api,
    provider: state.provider,
    model: state.model,
    ...state.responseModel === undefined ? {} : { responseModel: state.responseModel },
    ...state.responseId === undefined ? {} : { responseId: state.responseId },
    usage: emptyUsage(),
    stopReason: state.stopReason,
    timestamp: 0,
  }
}

/** Reconstruct one pi-ai assistant history message from Harness content. */
export function toPiAssistant(message: Message): AssistantMessage {
  const source = message.source
  return source.kind === 'model' && source.replayState !== undefined
    ? replayedAssistant(message, source, source.replayState)
    : foreignAssistant(message)
}
