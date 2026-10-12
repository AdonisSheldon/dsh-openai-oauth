import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CustomModelStore } from '../dist/test/model-store.js'

const sandbox = join(process.cwd(), '.cache', 'model-store-tests')

function temporaryHome() {
  mkdirSync(sandbox, { recursive: true })
  return mkdtempSync(join(sandbox, 'home-'))
}

test('saves a custom model with owner-only modes and reloads it', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  assert.equal(store.loadError, undefined)
  assert.deepEqual(store.list(), [])
  assert.equal(store.modelFile, join(dshHome, 'plugins', 'dsh-openai-oauth', 'models.json'))
  assert.equal(store.stateDirectory, join(dshHome, 'plugins', 'dsh-openai-oauth'))
  const committed = await store.save({ id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000 })
  assert.deepEqual(committed, [{ id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000 }])
  assert.deepEqual(store.list(), committed)
  assert.equal(statSync(store.modelFile).mode & 0o777, 0o600)
  assert.equal(statSync(store.stateDirectory).mode & 0o777, 0o700)
  const reopened = new CustomModelStore(dshHome)
  assert.equal(reopened.loadError, undefined)
  assert.deepEqual(reopened.list(), committed)
})

test('overrides a built-in and clears the override on remove', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  await store.save({ id: 'gpt-6.1-sol', contextWindow: 900_000, maxTokens: 64_000 })
  assert.deepEqual(store.list(), [{ id: 'gpt-6.1-sol', contextWindow: 900_000, maxTokens: 64_000 }])
  await assert.rejects(
    store.save({ id: 'gpt-6.1-sol', name: 'Renamed', contextWindow: 900_000, maxTokens: 64_000 }),
    { code: 'INVALID_MODEL_NAME' },
  )
  await store.save({ id: 'gpt-6.1-sol', contextWindow: 500_000, maxTokens: 8_000 })
  assert.deepEqual(store.list(), [{ id: 'gpt-6.1-sol', contextWindow: 500_000, maxTokens: 8_000 }])
  await store.remove('gpt-6.1-sol')
  assert.deepEqual(store.list(), [])
  assert.deepEqual(new CustomModelStore(dshHome).list(), [])
})

test('removes a custom model and reports an unknown id', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  await store.save({ id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000 })
  await store.save({ id: 'custom-2', contextWindow: 100_000, maxTokens: 4_096 })
  await store.remove('custom-1')
  assert.deepEqual(store.list(), [{ id: 'custom-2', contextWindow: 100_000, maxTokens: 4_096 }])
  await assert.rejects(store.remove('custom-1'), { code: 'UNKNOWN_MODEL' })
  await assert.rejects(store.remove('gpt-6.1-sol'), { code: 'UNKNOWN_MODEL' })
  await assert.rejects(store.remove('bad id'), { code: 'INVALID_MODEL_ID' })
})

test('a malformed file is tolerated as loadError and recovered by the next save', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  await new CustomModelStore(dshHome).save({ id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000 })
  const file = join(dshHome, 'plugins', 'dsh-openai-oauth', 'models.json')
  writeFileSync(file, '{"version":1,"models":[{"id":"broken"}]}\n')
  const broken = new CustomModelStore(dshHome)
  assert.equal(broken.loadError, 'INVALID_MODEL_FILE')
  assert.deepEqual(broken.list(), [])
  await broken.save({ id: 'custom-2', contextWindow: 100_000, maxTokens: 1_000 })
  assert.equal(broken.loadError, undefined)
  assert.deepEqual(broken.list(), [{ id: 'custom-2', contextWindow: 100_000, maxTokens: 1_000 }])
  assert.equal(new CustomModelStore(dshHome).loadError, undefined)
})

test('refuses a symlinked state directory', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const elsewhere = join(dshHome, 'elsewhere')
  mkdirSync(join(dshHome, 'plugins'), { recursive: true, mode: 0o700 })
  mkdirSync(elsewhere, { mode: 0o700 })
  symlinkSync(elsewhere, join(dshHome, 'plugins', 'dsh-openai-oauth'))
  const store = new CustomModelStore(dshHome)
  assert.equal(store.loadError, 'UNSAFE_MODEL_PATH')
  assert.deepEqual(store.list(), [])
  await assert.rejects(
    store.save({ id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000 }),
    { code: 'UNSAFE_MODEL_PATH' },
  )
})

test('refuses a group-readable file and recovers it on the next save', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  await store.save({ id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000 })
  chmodSync(store.modelFile, 0o644)
  const unsafe = new CustomModelStore(dshHome)
  assert.equal(unsafe.loadError, 'UNSAFE_MODEL_PATH')
  assert.deepEqual(unsafe.list(), [])
  await unsafe.save({ id: 'custom-2', contextWindow: 100_000, maxTokens: 512 })
  assert.equal(unsafe.loadError, undefined)
  assert.equal(statSync(unsafe.modelFile).mode & 0o777, 0o600)
  assert.deepEqual(new CustomModelStore(dshHome).list(), [{ id: 'custom-2', contextWindow: 100_000, maxTokens: 512 }])
})

test('refuses more than 64 customs without touching existing entries', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  for (let index = 0; index < 64; index += 1) {
    await store.save({ id: 'custom-' + index, contextWindow: 200_000, maxTokens: 1_000 })
  }
  await assert.rejects(
    store.save({ id: 'custom-64', contextWindow: 200_000, maxTokens: 1_000 }),
    { code: 'MODEL_LIMIT_REACHED' },
  )
  await assert.rejects(
    store.save({ id: 'gpt-6.1-sol', name: 'Named', contextWindow: 200_000, maxTokens: 1_000 }),
    { code: 'INVALID_MODEL_NAME' },
  )
  await store.save({ id: 'custom-0', contextWindow: 300_000, maxTokens: 2_000 })
  assert.deepEqual(store.list()[0], { id: 'custom-0', contextWindow: 300_000, maxTokens: 2_000 })
  assert.equal(store.list().length, 64)
})

test('notifies listeners with the committed snapshot and isolates listener failures', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  const seen = []
  const stop = store.onChange(models => { seen.push(models.map(model => model.id)) })
  store.onChange(() => { throw new Error('listener failure') })
  await store.save({ id: 'custom-1', contextWindow: 200_000, maxTokens: 1_000 })
  stop()
  await store.save({ id: 'custom-2', contextWindow: 200_000, maxTokens: 1_000 })
  await store.remove('custom-1')
  assert.deepEqual(seen, [['custom-1']])
})
