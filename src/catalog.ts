/** Persisted model overlay: validation, effective resolution, and the settings view. */
import {
  BASE_MODEL,
  OPENAI_CODEX_MODELS,
  STANDARD_THINKING_LEVEL_MAP,
} from './models.js'
import type { Model } from './models.js'

/** One overlay entry exactly as persisted in models.json. */
export interface StoredModel {
  id: string
  contextWindow: number
  maxTokens: number
  name?: string
}

/** Stable refusal code for one overlay draft. */
export type ModelValidationCode =
  | 'INVALID_MODEL_ID'
  | 'INVALID_CONTEXT_WINDOW'
  | 'INVALID_MAX_TOKENS'
  | 'INVALID_MODEL_NAME'
  | 'MODEL_LIMIT_REACHED'

/** Discriminated validation outcome carrying a redacted code and message. */
export type ModelValidation =
  | { ok: true; value: StoredModel }
  | { ok: false; code: ModelValidationCode; message: string }

/** Discriminated outcome for one bare model id. */
export type ModelIdValidation =
  | { ok: true; value: string }
  | { ok: false; code: ModelValidationCode; message: string }

/** One row of the catalog view served on the plugin route. */
export interface ModelRow {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  builtIn: boolean
  overridden: boolean
  defaultContextWindow: number | null
  defaultMaxTokens: number | null
}

/** Accepted model ids: one leading alphanumeric, then up to 63 more id characters. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
/** Inclusive context window bounds. */
export const MIN_CONTEXT_WINDOW = 1_024
/** Inclusive upper context window bound. */
export const MAX_CONTEXT_WINDOW = 10_000_000
/** Inclusive display name length bound. */
export const MAX_MODEL_NAME_LENGTH = 64
/** Maximum stored custom models. */
export const MAX_CUSTOM_MODELS = 64

const ID_MESSAGE = 'A model id must be 1 to 64 characters of letters, digits, dot, underscore, colon or hyphen and start with a letter or digit.'
const NAME_MESSAGE = `A model name must be 1 to ${MAX_MODEL_NAME_LENGTH} characters without control characters.`
/** C0 and C1 control characters, plus DEL. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Return true when the shipped catalog already owns this id. */
export function isBuiltInModelId(id: string): boolean {
  return OPENAI_CODEX_MODELS.some(model => model.id === id)
}

/** Count the stored entries that are not overrides of shipped models. */
export function countCustomModels(stored: readonly StoredModel[]): number {
  return stored.filter(entry => !isBuiltInModelId(entry.id)).length
}

/** Validate one bare model id without any other draft field. */
export function validateModelId(raw: unknown): ModelIdValidation {
  if (typeof raw !== 'string' || !MODEL_ID_PATTERN.test(raw)) {
    return { ok: false, code: 'INVALID_MODEL_ID', message: ID_MESSAGE }
  }
  return { ok: true, value: raw }
}

function validateName(raw: unknown): { ok: true; value: string | undefined } | { ok: false; code: ModelValidationCode; message: string } {
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== 'string') return { ok: false, code: 'INVALID_MODEL_NAME', message: NAME_MESSAGE }
  const trimmed = raw.trim()
  if (trimmed.length === 0 || raw.length > MAX_MODEL_NAME_LENGTH || CONTROL_CHARACTERS.test(raw)) {
    return { ok: false, code: 'INVALID_MODEL_NAME', message: NAME_MESSAGE }
  }
  return { ok: true, value: trimmed }
}

/**
 * Validate one overlay draft against the stored snapshot.
 * @param raw - untrusted draft carrying id, contextWindow, maxTokens and an optional name.
 * @param stored - entries already persisted, used for the custom model capacity rule.
 * @returns the normalized entry, or the refusal code and message.
 */
export function validateModelDraft(raw: unknown, stored: readonly StoredModel[] = []): ModelValidation {
  if (!isRecord(raw)) return { ok: false, code: 'INVALID_MODEL_ID', message: ID_MESSAGE }
  const id = validateModelId(raw['id'])
  if (!id.ok) return { ok: false, code: id.code, message: id.message }
  const contextWindow = raw['contextWindow']
  if (typeof contextWindow !== 'number' || !Number.isSafeInteger(contextWindow)
    || contextWindow < MIN_CONTEXT_WINDOW || contextWindow > MAX_CONTEXT_WINDOW) {
    return {
      ok: false,
      code: 'INVALID_CONTEXT_WINDOW',
      message: `A context window must be a whole number between ${MIN_CONTEXT_WINDOW} and ${MAX_CONTEXT_WINDOW}.`,
    }
  }
  const maxTokens = raw['maxTokens']
  if (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > contextWindow) {
    return {
      ok: false,
      code: 'INVALID_MAX_TOKENS',
      message: 'A maximum output must be a whole number of at least 1 and at most the context window.',
    }
  }
  if (isBuiltInModelId(id.value)) {
    if (raw['name'] !== undefined) {
      return { ok: false, code: 'INVALID_MODEL_NAME', message: 'A built-in model override cannot carry a display name.' }
    }
    return { ok: true, value: { id: id.value, contextWindow, maxTokens } }
  }
  const name = validateName(raw['name'])
  if (!name.ok) return { ok: false, code: name.code, message: name.message }
  if (!stored.some(entry => entry.id === id.value) && countCustomModels(stored) >= MAX_CUSTOM_MODELS) {
    return {
      ok: false,
      code: 'MODEL_LIMIT_REACHED',
      message: `At most ${MAX_CUSTOM_MODELS} custom models can be stored.`,
    }
  }
  return name.value === undefined
    ? { ok: true, value: { id: id.value, contextWindow, maxTokens } }
    : { ok: true, value: { id: id.value, name: name.value, contextWindow, maxTokens } }
}

function partition(stored: readonly StoredModel[]): { overrides: Map<string, StoredModel>; customs: StoredModel[] } {
  const overrides = new Map<string, StoredModel>()
  const customs: StoredModel[] = []
  for (const entry of stored) {
    if (isBuiltInModelId(entry.id)) overrides.set(entry.id, entry)
    else customs.push(entry)
  }
  return { overrides, customs }
}

/**
 * Resolve the effective catalog: shipped models in catalog order with any stored
 * override applied, then stored custom models in file order.
 * @param stored - persisted overlay entries.
 * @returns the provider-owned model catalog, pure and synchronous.
 */
export function resolveCatalog(stored: readonly StoredModel[]): Model<'openai-codex-responses'>[] {
  const { overrides, customs } = partition(stored)
  const catalog: Model<'openai-codex-responses'>[] = OPENAI_CODEX_MODELS.map(model => {
    const override = overrides.get(model.id)
    return override === undefined
      ? model
      : { ...model, contextWindow: override.contextWindow, maxTokens: override.maxTokens }
  })
  for (const entry of customs) {
    catalog.push({
      ...BASE_MODEL,
      id: entry.id,
      name: entry.name ?? entry.id,
      input: ['text', 'image'],
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      thinkingLevelMap: { ...STANDARD_THINKING_LEVEL_MAP },
    })
  }
  return catalog
}

/**
 * Build the settings-facing view of the effective catalog.
 * @param stored - persisted overlay entries.
 * @returns one row per built-in then per custom model, with pristine built-in defaults.
 */
export function resolveModelRows(stored: readonly StoredModel[]): ModelRow[] {
  const { overrides, customs } = partition(stored)
  const rows: ModelRow[] = OPENAI_CODEX_MODELS.map(model => {
    const override = overrides.get(model.id)
    return {
      id: model.id,
      name: model.name,
      contextWindow: override?.contextWindow ?? model.contextWindow,
      maxTokens: override?.maxTokens ?? model.maxTokens,
      builtIn: true,
      overridden: override !== undefined,
      defaultContextWindow: model.contextWindow,
      defaultMaxTokens: model.maxTokens,
    }
  })
  for (const entry of customs) {
    rows.push({
      id: entry.id,
      name: entry.name ?? entry.id,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      builtIn: false,
      overridden: false,
      defaultContextWindow: null,
      defaultMaxTokens: null,
    })
  }
  return rows
}
