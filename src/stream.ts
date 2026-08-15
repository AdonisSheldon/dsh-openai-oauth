/** pi-ai-to-Harness stream conversion derived from MIT-licensed DeepSeek Harness. */
import {
  CallId,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type { FinishReason, LlmFailure, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { isContextOverflow } from '@earendil-works/pi-ai'
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai'
import { toPiReplayState } from './replay.js'

/** Map pi-ai's disjoint usage fields into Harness usage. */
export function mapUsage(usage: Usage): TokenUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    ...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
    ...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {},
    ...usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning },
  }
}

function providerFailure(message: string): LlmFailure {
  if (/Provider is not configured|No API key/i.test(message)) {
    return { code: 'MISSING_CREDENTIAL', message: 'OpenAI Codex is not signed in. Sign in with Browser or Device Code.' }
  }
  if (/\b(?:401|403)\b|unauthori[sz]ed|invalid.?grant/i.test(message)) {
    return { code: 'AUTH', message: 'OpenAI Codex authentication failed. Sign in again.' }
  }
  if (/\b429\b|rate.?limit/i.test(message)) {
    return { code: 'RATE_LIMIT', message: 'OpenAI Codex rate limit reached. Retry later.' }
  }
  if (/quota|billing|insufficient.?credits/i.test(message)) {
    return { code: 'QUOTA_EXCEEDED', message: 'OpenAI Codex quota is unavailable for this account.' }
  }
  if (/time(?:d)?\s*out|timeout/i.test(message)) {
    return { code: 'TIMEOUT', message: 'OpenAI Codex request timed out.' }
  }
  if (/network|connection|socket|fetch|ECONN[A-Z]+|terminated|premature close/i.test(message)) {
    return { code: 'TRANSPORT', message: 'OpenAI Codex transport failed.' }
  }
  return { code: 'PI_AI_ERROR', message: 'OpenAI Codex request failed.' }
}

/** Convert a thrown pi-ai failure without retaining its message or cause. */
export function redactedPiError(error: unknown): LlmError {
  const failure = providerFailure(error instanceof Error ? error.message : '')
  return new LlmError(failure.message, failure.code)
}

function stopReason(message: AssistantMessage, contextWindow?: number): FinishReason {
  if (isContextOverflow(message, contextWindow)) {
    return {
      kind: 'error',
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE, message: 'OpenAI Codex context window was exceeded.' },
    }
  }
  switch (message.stopReason) {
    case 'stop': return message.content.length === 0
      ? { kind: 'error', failure: { code: EMPTY_RESPONSE_CODE, message: 'OpenAI Codex returned an empty response.' } }
      : { kind: 'stop' }
    case 'length': return { kind: 'max-tokens' }
    case 'toolUse': return { kind: 'tool-calls' }
    case 'aborted': return { kind: 'aborted', failure: { code: 'ABORTED', message: 'OpenAI Codex request was aborted.' } }
    case 'error': return { kind: 'error', failure: providerFailure(message.errorMessage ?? '') }
  }
}

/** Translate one pi-ai event stream into Harness chunks. */
export async function* toStreamChunks(
  events: AsyncIterable<AssistantMessageEvent>,
  contextWindow?: number,
): AsyncGenerator<StreamChunk> {
  const tools = new Map<number, { id: string; name: string }>()
  for await (const event of events) {
    switch (event.type) {
      case 'start': break
      case 'text_start': yield { type: 'block-start', index: event.contentIndex, blockType: 'text' }; break
      case 'text_delta': yield { type: 'text-delta', index: event.contentIndex, text: event.delta }; break
      case 'text_end': yield { type: 'block-end', index: event.contentIndex, block: { type: 'text', text: event.content } }; break
      case 'thinking_start': yield { type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }; break
      case 'thinking_delta': yield { type: 'reasoning-delta', index: event.contentIndex, text: event.delta }; break
      case 'thinking_end': yield { type: 'block-end', index: event.contentIndex, block: { type: 'reasoning', text: event.content } }; break
      case 'toolcall_start': {
        const partial = event.partial.content[event.contentIndex]
        tools.set(event.contentIndex, partial?.type === 'toolCall'
          ? { id: partial.id, name: partial.name }
          : { id: '', name: '' })
        yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        const tool = tools.get(event.contentIndex)
        yield {
          type: 'tool-call-delta',
          index: event.contentIndex,
          id: CallId(tool?.id ?? ''),
          ...tool?.name === undefined || tool.name.length === 0 ? {} : { name: tool.name },
          argumentsDelta: event.delta,
        }
        break
      }
      case 'toolcall_end': yield {
        type: 'block-end',
        index: event.contentIndex,
        block: {
          type: 'tool-call',
          id: CallId(event.toolCall.id),
          name: event.toolCall.name,
          arguments: JSON.stringify(event.toolCall.arguments),
        },
      }; break
      case 'done':
        yield { type: 'usage', usage: mapUsage(event.message.usage) }
        yield { type: 'finish', reason: stopReason(event.message, contextWindow), replayState: toPiReplayState(event.message) }
        return
      case 'error':
        yield { type: 'usage', usage: mapUsage(event.error.usage) }
        yield { type: 'finish', reason: stopReason(event.error, contextWindow) }
        return
    }
  }
  throw new LlmError('OpenAI Codex event stream closed without a terminal event.', 'STREAM_CLOSED')
}
