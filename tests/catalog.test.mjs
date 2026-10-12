import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_CUSTOM_MODELS,
  isBuiltInModelId,
  resolveCatalog,
  resolveModelRows,
  validateModelDraft,
} from '../dist/test/catalog.js'
import { createPluginRuntime } from '../dist/test/index.js'
import { OPENAI_CODEX_MODELS, getSupportedThinkingLevels } from '../dist/test/models.js'

test('the plugin runtime keeps getModels synchronous and applies the persisted overlay', async (t) => {
  const sandbox = join(process.cwd(), '.cache', 'model-store-tests')
  mkdirSync(sandbox, { recursive: true })
  const dshHome = mkdtempSync(join(sandbox, 'runtime-'))
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))

  const runtime = createPluginRuntime({ dshHome })
  assert.deepEqual(runtime.store.list(), [])
  assert.ok(runtime.models.getModels('openai-codex').some(model => model.id === 'gpt-6.1-sol'))
  await runtime.store.save({ id: 'gpt-6.1-sol', contextWindow: 400_000, maxTokens: 32_000 })
  await runtime.store.save({ id: 'custom-sol', name: 'Custom Sol', contextWindow: 500_000, maxTokens: 64_000 })

  const ids = runtime.models.getModels('openai-codex').map(model => model.id)
  assert.deepEqual(ids.slice(-1), ['custom-sol'])
  assert.equal(runtime.models.getModel('openai-codex', 'gpt-6.1-sol').contextWindow, 400_000)
  assert.equal(runtime.models.getModel('openai-codex', 'custom-sol').name, 'Custom Sol')
  assert.equal(runtime.models.getModels('other-provider').length, 0)

  const reopened = createPluginRuntime({ dshHome })
  assert.equal(reopened.store.list().length, 2)
  assert.equal(reopened.models.getModel('openai-codex', 'custom-sol').maxTokens, 64_000)
})

const ACCEPTED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const custom = (id, extra = {}) => ({ id, contextWindow: 200_000, maxTokens: 32_000, ...extra })
const builtInIds = OPENAI_CODEX_MODELS.map(model => model.id)

test('gpt-6.1-sol ships immediately after gpt-6-astra with the verified capacities', () => {
  assert.equal(builtInIds.indexOf('gpt-6.1-sol'), builtInIds.indexOf('gpt-6-astra') + 1)
  const model = OPENAI_CODEX_MODELS.find(entry => entry.id === 'gpt-6.1-sol')
  assert.equal(model.name, 'GPT-6.1 Sol')
  assert.equal(model.contextWindow, 1_050_000)
  assert.equal(model.maxTokens, 128_000)
  assert.deepEqual(model.input, ['text', 'image'])
  assert.equal(model.api, 'openai-codex-responses')
  assert.equal(model.provider, 'openai-codex')
  assert.equal(model.reasoning, true)
  assert.equal(isBuiltInModelId('gpt-6.1-sol'), true)
  assert.equal(isBuiltInModelId('custom-1'), false)
})

test('gpt-6.1-sol advertises only efforts the model accepts', () => {
  const model = OPENAI_CODEX_MODELS.find(entry => entry.id === 'gpt-6.1-sol')
  const levels = getSupportedThinkingLevels(model)
  assert.deepEqual(levels, ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  for (const level of levels) {
    const wire = model.thinkingLevelMap[level]
    assert.notEqual(wire, null)
    assert.ok(ACCEPTED_EFFORTS.has(wire), level + ' maps to unsupported effort ' + String(wire))
  }
})

test('a stored override applies to its built-in and customs append in stored order', () => {
  const catalog = resolveCatalog([
    { id: 'custom-b', name: 'Custom B', contextWindow: 300_000, maxTokens: 64_000 },
    { id: 'gpt-6.1-sol', contextWindow: 900_000, maxTokens: 96_000 },
    { id: 'custom-a', contextWindow: 150_000, maxTokens: 8_000 },
  ])
  assert.deepEqual(catalog.map(model => model.id), [...builtInIds, 'custom-b', 'custom-a'])
  const overridden = catalog.find(model => model.id === 'gpt-6.1-sol')
  assert.equal(overridden.contextWindow, 900_000)
  assert.equal(overridden.maxTokens, 96_000)
  assert.equal(overridden.name, 'GPT-6.1 Sol')
  assert.deepEqual(overridden.input, ['text', 'image'])
  const [first, second] = [catalog.at(-2), catalog.at(-1)]
  assert.equal(first.name, 'Custom B')
  assert.equal(second.name, 'custom-a')
  for (const model of [first, second]) {
    assert.equal(model.api, 'openai-codex-responses')
    assert.equal(model.provider, 'openai-codex')
    assert.equal(model.baseUrl, 'https://chatgpt.com/backend-api')
    assert.equal(model.reasoning, true)
    assert.deepEqual(model.input, ['text', 'image'])
    assert.deepEqual(getSupportedThinkingLevels(model), ['minimal', 'low', 'medium', 'high', 'xhigh'])
  }
})

test('rows report effective values, override flags and pristine built-in defaults', () => {
  const rows = resolveModelRows([
    { id: 'gpt-6-astra', contextWindow: 100_000, maxTokens: 4_096 },
    { id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000 },
  ])
  assert.deepEqual(rows.map(row => row.id), [...builtInIds, 'custom-1'])
  assert.deepEqual(rows.find(row => row.id === 'gpt-6-astra'), {
    id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 100_000, maxTokens: 4_096,
    builtIn: true, overridden: true, defaultContextWindow: 1_050_000, defaultMaxTokens: 128_000,
  })
  assert.deepEqual(rows.at(-1), {
    id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000,
    builtIn: false, overridden: false, defaultContextWindow: null, defaultMaxTokens: null,
  })
  const plain = rows.find(row => row.id === 'gpt-5.4')
  assert.equal(plain.overridden, false)
  assert.equal(plain.contextWindow, 272_000)
  assert.equal(plain.maxTokens, 128_000)
})

test('validation refuses every malformed draft with a stable code', () => {
  const cases = [
    [custom('bad id'), 'INVALID_MODEL_ID'],
    [custom('a'.repeat(65)), 'INVALID_MODEL_ID'],
    [custom('-leading'), 'INVALID_MODEL_ID'],
    [custom(''), 'INVALID_MODEL_ID'],
    [{ contextWindow: 200_000, maxTokens: 1_000 }, 'INVALID_MODEL_ID'],
    [custom('ok', { contextWindow: 1_023 }), 'INVALID_CONTEXT_WINDOW'],
    [custom('ok', { contextWindow: 200_000.5 }), 'INVALID_CONTEXT_WINDOW'],
    [custom('ok', { contextWindow: 10_000_001 }), 'INVALID_CONTEXT_WINDOW'],
    [custom('ok', { contextWindow: '200000' }), 'INVALID_CONTEXT_WINDOW'],
    [custom('ok', { maxTokens: 0 }), 'INVALID_MAX_TOKENS'],
    [custom('ok', { maxTokens: 200_001 }), 'INVALID_MAX_TOKENS'],
    [custom('ok', { maxTokens: 1.5 }), 'INVALID_MAX_TOKENS'],
    [{ id: 'gpt-5.4', name: 'Renamed', contextWindow: 200_000, maxTokens: 1_000 }, 'INVALID_MODEL_NAME'],
    [{ id: 'gpt-5.4', name: 'Renamed', contextWindow: 200_000, maxTokens: 1_000 }, 'INVALID_MODEL_NAME'],
    [custom('ok', { name: '\u0007bell' }), 'INVALID_MODEL_NAME'],
    [custom('ok', { name: '\u009bescape' }), 'INVALID_MODEL_NAME'],
    [custom('ok', { name: '   ' }), 'INVALID_MODEL_NAME'],
    [custom('ok', { name: 'n'.repeat(65) }), 'INVALID_MODEL_NAME'],
  ]
  for (const [draft, code] of cases) {
    const result = validateModelDraft(draft)
    assert.equal(result.ok, false, JSON.stringify(draft))
    assert.equal(result.code, code, JSON.stringify(draft))
    assert.equal(typeof result.message, 'string')
  }
})

test('validation normalizes accepted drafts', () => {
  assert.deepEqual(validateModelDraft({ id: 'gpt-5.4', contextWindow: 272_000, maxTokens: 128_000 }), {
    ok: true, value: { id: 'gpt-5.4', contextWindow: 272_000, maxTokens: 128_000 },
  })
  const named = validateModelDraft(custom('custom-1', { name: '  Custom One  ' }))
  assert.equal(named.ok, true)
  assert.equal(named.value.name, 'Custom One')
  const unnamed = validateModelDraft(custom('custom-2'))
  assert.equal(unnamed.ok, true)
  assert.equal('name' in unnamed.value, false)
})

test('a sixty-fifth custom model is refused while updates and overrides stay allowed', () => {
  const stored = Array.from({ length: MAX_CUSTOM_MODELS }, (_value, index) => custom('custom-' + index))
  const refused = validateModelDraft(custom('custom-64'), stored)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'MODEL_LIMIT_REACHED')
  assert.equal(validateModelDraft(custom('custom-0', { maxTokens: 1_024 }), stored).ok, true)
  assert.equal(validateModelDraft({ id: 'gpt-5.4', contextWindow: 300_000, maxTokens: 1_000 }, stored).ok, true)
})
