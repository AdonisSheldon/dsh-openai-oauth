/** Validate the Codex models endpoint without trusting response URLs or diagnostic text. */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Model, ThinkingLevel } from './models.js'

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
// Protocol compatibility version for the Codex models endpoint, not a CLI dependency.
export const CODEX_CATALOG_CLIENT_VERSION = '0.166.0'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new LlmError('OpenAI Codex returned an invalid model catalog.', 'PROTOCOL_ERROR')
}

function effort(value: unknown): value is ThinkingLevel {
  return typeof value === 'string'
    && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)
}

/** Parse remote display and capability metadata; hidden models remain resolvable for history. */
export function parseModelCatalog(value: unknown): readonly Model<'openai-codex-responses'>[] {
  if (!record(value) || !Array.isArray(value['models'])) return invalid()
  const ids = new Set<string>()
  return value['models'].map((raw: unknown) => {
    if (!record(raw) || typeof raw['slug'] !== 'string' || raw['slug'].length === 0
      || typeof raw['display_name'] !== 'string' || raw['display_name'].length === 0
      || !['list', 'hide'].includes(String(raw['visibility']))
      || !Array.isArray(raw['supported_reasoning_levels'])) return invalid()
    const id = raw['slug']
    if (ids.has(id)) return invalid()
    ids.add(id)
    const context = raw['context_window'] ?? raw['max_context_window']
    if (context !== undefined && (typeof context !== 'number' || !Number.isSafeInteger(context) || context <= 0)) return invalid()
    const modalities = raw['input_modalities'] ?? ['text']
    if (!Array.isArray(modalities) || !modalities.every((m: unknown) => typeof m === 'string')) return invalid()
    const input = modalities.filter((m: unknown): m is 'text' | 'image' => m === 'text' || m === 'image')
    if (input.length === 0) return invalid()
    const thinkingLevelMap: Partial<Record<ThinkingLevel, string | null>> = {}
    for (const level of raw['supported_reasoning_levels']) {
      if (!record(level) || typeof level['effort'] !== 'string') return invalid()
      if (effort(level['effort'])) thinkingLevelMap[level['effort']] = level['effort']
    }
    return {
      id, name: raw['display_name'], api: 'openai-codex-responses', provider: 'openai-codex',
      baseUrl: CODEX_BASE_URL, input, thinkingLevelMap,
      reasoning: Object.keys(thinkingLevelMap).length > 0,
      hidden: raw['visibility'] !== 'list',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...typeof context === 'number' ? { contextWindow: context } : {},
    }
  })
}
