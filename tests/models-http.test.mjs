import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CustomModelStore } from '../dist/test/model-store.js'
import { OAUTH_ROUTE_PATH, oauthRoute, parseModelIdBody, parseModelSaveBody } from '../dist/test/oauth-http.js'

const sandbox = join(process.cwd(), '.cache', 'model-store-tests')
const controller = {
  status: async () => ({ state: 'signed-out' }),
  start: async () => { throw new Error('unused') },
  cancel: async () => { throw new Error('unused') },
  logout: async () => ({ state: 'signed-out' }),
}

function temporaryHome() {
  mkdirSync(sandbox, { recursive: true })
  return mkdtempSync(join(sandbox, 'http-'))
}

async function serve(route) {
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, base: 'http://127.0.0.1:' + port, stop: () => { server.closeAllConnections(); server.close() } }
}

function save(base, body) {
  return fetch(base + OAUTH_ROUTE_PATH + '/models/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  })
}

function remove(base, body) {
  return fetch(base + OAUTH_ROUTE_PATH + '/models/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  })
}

test('save body parser accepts the two exact shapes and rejects every other key set', () => {
  assert.deepEqual(parseModelSaveBody({ id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000 }), {
    id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000,
  })
  assert.deepEqual(parseModelSaveBody({ id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000 }), {
    id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000,
  })
  assert.deepEqual(parseModelSaveBody({ id: 'gpt-6.1-sol', contextWindow: 1_050_000, maxTokens: 128_000 }), {
    id: 'gpt-6.1-sol', contextWindow: 1_050_000, maxTokens: 128_000,
  })
  for (const body of [
    { id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000, extra: true },
    { id: 'custom-1', contextWindow: 200_000 },
    { id: 'custom-1', maxTokens: 32_000 },
    { contextWindow: 200_000, maxTokens: 32_000 },
    { id: 'custom-1', contextWindow: 200_000, maxTokens: 32_000, name: 'ok', builtIn: false },
    [],
    null,
    'body',
  ]) {
    assert.throws(() => parseModelSaveBody(body), { code: 'INVALID_BODY' }, JSON.stringify(body))
  }
  assert.throws(() => parseModelSaveBody({ id: 'gpt-5.4', name: 'Renamed', contextWindow: 200_000, maxTokens: 1_000 }), { code: 'INVALID_MODEL_NAME' })
  assert.throws(() => parseModelSaveBody({ id: 'custom-1', contextWindow: 1, maxTokens: 1 }), { code: 'INVALID_CONTEXT_WINDOW' })
  assert.throws(() => parseModelSaveBody({ id: 'custom-1', contextWindow: 200_000, maxTokens: 200_001 }), { code: 'INVALID_MAX_TOKENS' })
  assert.throws(() => parseModelSaveBody({ id: 'bad id', contextWindow: 200_000, maxTokens: 1 }), { code: 'INVALID_MODEL_ID' })
})

test('remove body parser accepts exactly one id', () => {
  assert.equal(parseModelIdBody({ id: 'custom-1' }), 'custom-1')
  for (const body of [{}, { id: 'custom-1', extra: 1 }, { id: 'custom-1', name: 'x' }, null, ['custom-1']]) {
    assert.throws(() => parseModelIdBody(body), { code: 'INVALID_BODY' }, JSON.stringify(body))
  }
  assert.throws(() => parseModelIdBody({ id: 5 }), { code: 'INVALID_MODEL_ID' })
  assert.throws(() => parseModelIdBody({ id: 'bad id' }), { code: 'INVALID_MODEL_ID' })
})

test('GET /models lists built-ins then customs, and save/remove keep that view', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  const host = await serve(oauthRoute(controller, store))
  t.after(host.stop)

  const listed = await fetch(host.base + OAUTH_ROUTE_PATH + '/models')
  assert.equal(listed.status, 200)
  const view = await listed.json()
  assert.equal('error' in view, false)
  assert.deepEqual(view.models.slice(0, 2).map(row => row.id), ['gpt-5.3-codex-spark', 'gpt-5.4'])
  assert.equal(view.models.at(-1).id, 'gpt-6.1-sol')

  const saved = await save(host.base, { id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000 })
  assert.equal(saved.status, 200)
  const afterSave = await saved.json()
  assert.deepEqual(afterSave.models.at(-1), {
    id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000,
    builtIn: false, overridden: false, defaultContextWindow: null, defaultMaxTokens: null,
  })
  assert.deepEqual(afterSave.models.find(row => row.id === 'gpt-6.1-sol'), {
    id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 1_050_000, maxTokens: 128_000,
    builtIn: true, overridden: false, defaultContextWindow: 1_050_000, defaultMaxTokens: 128_000,
  })
  assert.deepEqual(store.list(), [{ id: 'custom-1', name: 'Custom One', contextWindow: 200_000, maxTokens: 32_000 }])

  const overridden = await save(host.base, { id: 'gpt-6.1-sol', contextWindow: 900_000, maxTokens: 64_000 })
  const afterOverride = await overridden.json()
  assert.deepEqual(afterOverride.models.find(row => row.id === 'gpt-6.1-sol'), {
    id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 900_000, maxTokens: 64_000,
    builtIn: true, overridden: true, defaultContextWindow: 1_050_000, defaultMaxTokens: 128_000,
  })

  const removedCustom = await remove(host.base, { id: 'custom-1' })
  assert.equal(removedCustom.status, 200)
  assert.equal((await removedCustom.json()).models.at(-1).id, 'gpt-6.1-sol')
  const removedOverride = await remove(host.base, { id: 'gpt-6.1-sol' })
  const afterRemove = await removedOverride.json()
  assert.equal(afterRemove.models.find(row => row.id === 'gpt-6.1-sol').overridden, false)
  assert.deepEqual(store.list(), [])
})

test('model endpoints keep the OAuth route failures', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  const host = await serve(oauthRoute(controller, store))
  t.after(host.stop)
  const models = host.base + OAUTH_ROUTE_PATH + '/models'

  const extraKey = await save(host.base, { id: 'custom-1', contextWindow: 200_000, maxTokens: 1_000, extra: true })
  assert.equal(extraKey.status, 400)
  assert.equal((await extraKey.json()).error.code, 'INVALID_BODY')

  const unknown = await remove(host.base, { id: 'custom-1' })
  assert.equal(unknown.status, 404)
  assert.equal((await unknown.json()).error.code, 'UNKNOWN_MODEL')

  const crossOrigin = await fetch(models + '/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'custom-1', contextWindow: 200_000, maxTokens: 1_000 }),
  })
  assert.equal(crossOrigin.status, 403)
  assert.equal((await crossOrigin.json()).error.code, 'SAME_ORIGIN_REQUIRED')

  const wrongMethod = await fetch(models + '/save')
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'POST')
  const wrongMethodGet = await fetch(models, { method: 'POST', headers: { 'content-type': 'application/json', origin: host.base, 'sec-fetch-site': 'same-origin' }, body: '{}' })
  assert.equal(wrongMethodGet.status, 405)
  assert.equal(wrongMethodGet.headers.get('allow'), 'GET')

  const notJson = await fetch(models + '/save', { method: 'POST', headers: { 'content-type': 'text/plain', origin: host.base, 'sec-fetch-site': 'same-origin' }, body: '{}' })
  assert.equal(notJson.status, 415)

  const oversized = await save(host.base, { id: 'custom-1', name: 'x'.repeat(5_000), contextWindow: 200_000, maxTokens: 1_000 })
  assert.equal(oversized.status, 413)
  assert.equal((await oversized.json()).error.code, 'BODY_TOO_LARGE')

  const missing = await fetch(models + '/unknown')
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'NOT_FOUND')
})

test('GET /models reports a tolerated load error without failing', async (t) => {
  const dshHome = temporaryHome()
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const store = new CustomModelStore(dshHome)
  await store.save({ id: 'custom-1', contextWindow: 200_000, maxTokens: 1_000 })
  writeFileSync(store.modelFile, 'not json\n')
  const broken = new CustomModelStore(dshHome)
  assert.equal(broken.loadError, 'INVALID_MODEL_FILE')
  const host = await serve(oauthRoute(controller, broken))
  t.after(host.stop)
  const response = await fetch(host.base + OAUTH_ROUTE_PATH + '/models')
  assert.equal(response.status, 200)
  const view = await response.json()
  assert.equal(view.error, 'INVALID_MODEL_FILE')
  assert.equal(view.models.length, 9)
  const saved = await save(host.base, { id: 'custom-2', contextWindow: 200_000, maxTokens: 1_000 })
  assert.equal(saved.status, 200)
  const recovered = await saved.json()
  assert.equal('error' in recovered, false)
  assert.deepEqual(recovered.models.at(-1).id, 'custom-2')
})

test('model endpoints are absent without an overlay store', async (t) => {
  const host = await serve(oauthRoute(controller))
  t.after(host.stop)
  const response = await fetch(host.base + OAUTH_ROUTE_PATH + '/models')
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.code, 'NOT_FOUND')
})
