import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OpenAiCodexAdapter } from '../dist/test/adapter.js'
import { CodexModels } from '../dist/test/codex-models.js'
import { toCodexContext } from '../dist/test/context.js'
import { toStreamChunks } from '../dist/test/stream.js'

const provider = 'openai-codex'
const model = 'gpt-5.6-sol'
const text = value => ({ type: 'text', text: value })
const assistant = ids => ({
  role: 'assistant', source: { kind: 'model', provider: 'foreign', model: 'foreign' },
  content: ids.map(id => ({ type: 'tool-call', id, name: 'test_tool', arguments: '{}' })),
})
const tool = (id, content = [text('result')], extra = {}) => ({
  role: 'tool', toolCallId: id, content, ...extra,
})
const options = messages => ({ provider, model, messages })
const credential = {
  type: 'oauth', access: 'test-only-access', refresh: 'test-only-refresh',
  accountId: 'test-only-account', expires: Number.MAX_SAFE_INTEGER,
}
const store = { read: async () => credential }
const done = () => new Response('data: ' + JSON.stringify({
  type: 'response.completed', response: { status: 'completed' },
}) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
function adapterWith(fetch) {
  const models = new CodexModels(store, {
    fetch,
    refresh: async () => { throw new Error('Unexpected refresh') },
  })
  return new OpenAiCodexAdapter(models)
}
async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}

for (const ids of [['call_one'], ['call_one|fc_one'], ['call_one|fc_one', 'call_two|fc_two']]) {
  test(`adapter pairs all tool outputs (${ids.join(', ')})`, async () => {
    let body
    const adapter = adapterWith(async (_url, init) => {
      body = JSON.parse(init.body)
      return done()
    })
    await collect(adapter.stream(options([assistant(ids), ...ids.map(id => tool(id))])))
    const calls = body.input.filter(item => item.type === 'function_call')
    const outputs = body.input.filter(item => item.type === 'function_call_output')
    assert.deepEqual(outputs.map(item => item.call_id), calls.map(item => item.call_id))
    assert.equal(outputs.length, ids.length)
    assert.ok(outputs.every(item => item.output === 'result'))
    assert.equal(body.input.filter(item => item.role === 'user').length, 0)
  })
}

test('tool role: empty output, errors and unknown names are preserved', async () => {
  const context = await toCodexContext(options([tool('call_missing', [], { isError: true })]))
  assert.deepEqual(context.messages, [{
    role: 'toolResult', toolCallId: 'call_missing', toolName: 'unknown',
    content: [text('(no output)')], isError: true, timestamp: 0,
  }])
})

test('tool role: resolves tool name and defaults isError to false', async () => {
  const context = await toCodexContext(options([assistant(['call_one']), tool('call_one')]))
  assert.equal(context.messages[1].toolName, 'test_tool')
  assert.equal(context.messages[1].isError, false)
})

test('tool role: image output reaches Responses input through adapter', async () => {
  const ref = { id: 'test-image', mediaType: 'image/png' }
  const signal = new AbortController().signal
  let body
  const models = new CodexModels(store, {
    refresh: async () => credential,
    fetch: async (_url, init) => { body = JSON.parse(init.body); return done() },
  })
  const adapter = new OpenAiCodexAdapter(models, {
    attachments: () => ({ readImage: async (attachment, receivedSignal) => {
      assert.equal(attachment, ref)
      assert.equal(receivedSignal, signal)
      return { data: new Uint8Array([1, 2, 3]), ref }
    } }),
  })
  await collect(adapter.stream({ ...options([
    assistant(['call_image']), tool('call_image', [text('image'), { type: 'image', attachment: ref }]),
  ]), signal }))
  assert.deepEqual(body.input.at(-1), {
    type: 'function_call_output', call_id: 'call_image', output: [
      { type: 'input_text', text: 'image' },
      { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,AQID' },
    ],
  })
})

test('tool role: unsupported content fails before transport', async () => {
  let requested = false
  const adapter = adapterWith(async () => { requested = true; return done() })
  await assert.rejects(collect(adapter.stream(options([
    tool('call_one', [{ type: 'reasoning', text: 'invalid tool output' }]),
  ]))), { code: 'UNSUPPORTED_CONTENT' })
  assert.equal(requested, false)
})

test('tool role: image output requires attachment service', async () => {
  await assert.rejects(toCodexContext(options([
    tool('call_one', [{ type: 'image', attachment: { id: 'test-image' } }]),
  ])), { code: 'UNSUPPORTED_CONTENT' })
})

for (const [status, code, message] of [
  [400, 'CODEX_ERROR', 'rejected the request (HTTP 400)'],
  [401, 'AUTH', 'authentication failed'],
  [403, 'AUTH', 'authentication failed'],
  [404, 'CODEX_ERROR', 'endpoint not found (HTTP 404)'],
  [408, 'TIMEOUT', 'timed out'],
  [409, 'CODEX_ERROR', 'request failed (HTTP 409)'],
  [422, 'CODEX_ERROR', 'rejected the request (HTTP 422)'],
  [429, 'RATE_LIMIT', 'rate limit reached'],
  [500, 'SERVER', 'server error (HTTP 500)'],
  [502, 'SERVER', 'server error (HTTP 502)'],
  [503, 'SERVER', 'server error (HTTP 503)'],
  [504, 'TIMEOUT', 'timed out'],
  [520, 'SERVER', 'server error (HTTP 520)'],
  [599, 'SERVER', 'server error (HTTP 599)'],
]) {
  test(`HTTP ${status}: adapter preserves ${code} without leaking response body`, async () => {
    const adapter = adapterWith(async () => new Response('private-backend-detail', { status }))
    await assert.rejects(collect(adapter.stream(options([]))), error => {
      assert.equal(error.code, code)
      assert.ok(error.message.includes(message), error.message)
      assert.ok(!error.message.includes('private-backend-detail'))
      assert.equal(error.cause, undefined)
      return true
    })
  })
}

test('GPT-6 Astra is selectable with the synced capabilities', async () => {
  const adapter = adapterWith(async () => done())
  const models = await adapter.listModels(provider)
  assert.equal(models.filter(model => model.id === 'gpt-6-astra').length, 1)
  const resolved = await adapter.resolveModel(provider, 'gpt-6-astra')
  assert.equal(resolved.context.contextWindow, 1_050_000)
  assert.deepEqual(resolved.inputModalities, ['text', 'image'])
  assert.deepEqual(resolved.reasoning.efforts.map(effort => effort.id), ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  await assert.rejects(adapter.resolveModel(provider, 'gpt-unknown'), { code: 'UNKNOWN_MODEL' })
})

test('GPT-6 Astra maps minimal reasoning to low in the wire request', async () => {
  let body
  const adapter = adapterWith(async (_url, init) => { body = JSON.parse(init.body); return done() })
  await collect(adapter.stream({ ...options([]), model: 'gpt-6-astra', reasoningEffort: 'minimal' }))
  assert.equal(body.model, 'gpt-6-astra')
  assert.equal(body.reasoning.effort, 'low')
})

test('stream tool-call IDs survive delta and block conversion on the current host API', async () => {
  const toolCall = { type: 'toolCall', id: 'call_one|fc_one', name: 'test_tool', arguments: {} }
  async function* events() {
    yield { type: 'toolcall_start', contentIndex: 0, partial: { content: [toolCall] } }
    yield { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: {} }
    yield { type: 'toolcall_end', contentIndex: 0, toolCall }
    yield { type: 'done', message: {
      content: [toolCall], api: 'openai-codex-responses', provider, model, stopReason: 'toolUse',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    } }
  }
  const chunks = await collect(toStreamChunks(events()))
  assert.equal(chunks.find(chunk => chunk.type === 'tool-call-delta').id, toolCall.id)
  assert.equal(chunks.find(chunk => chunk.type === 'block-end').block.id, toolCall.id)
})

test('published entry imports on the current host API', async () => {
  const entry = await import('../lib/index.js')
  assert.equal(typeof entry.apply, 'function')
  assert.equal(typeof entry.OpenAiCodexAdapter, 'function')
})
test('resolveModel exposes the context window and the default output cap', async () => {
  const adapter = adapterWith(async () => done())
  const resolved = await adapter.resolveModel(provider, 'gpt-6.1-sol')
  assert.equal(resolved.context.contextWindow, 1_050_000)
  assert.equal(resolved.defaultMaxTokens, 128_000)
  const builtIn = await adapter.resolveModel(provider, 'gpt-6-astra')
  assert.equal(builtIn.defaultMaxTokens, 128_000)
})

test('a requested maxTokens reaches the Responses body as max_output_tokens', async () => {
  let body
  const adapter = adapterWith(async (_url, init) => { body = JSON.parse(init.body); return done() })
  await collect(adapter.stream({ ...options([]), maxTokens: 4_096 }))
  assert.equal(body.max_output_tokens, 4_096)
  await collect(adapter.stream(options([])))
  assert.equal('max_output_tokens' in body, false)
})

test('a stored overlay resolves a built-in override and a custom model', async () => {
  let body
  const overlay = { list: () => [
    { id: 'gpt-6.1-sol', contextWindow: 400_000, maxTokens: 32_000 },
    { id: 'custom-sol', name: 'Custom Sol', contextWindow: 500_000, maxTokens: 64_000 },
  ] }
  const models = new CodexModels(store, {
    store: overlay,
    fetch: async (_url, init) => { body = JSON.parse(init.body); return done() },
    refresh: async () => { throw new Error('Unexpected refresh') },
  })
  const adapter = new OpenAiCodexAdapter(models)
  assert.deepEqual(models.getModels(provider).map(entry => entry.id).slice(-1), ['custom-sol'])
  assert.equal(models.getModel('foreign-provider', 'custom-sol'), undefined)
  const listed = await adapter.listModels(provider)
  assert.ok(listed.some(entry => entry.id === 'custom-sol'))
  const overridden = await adapter.resolveModel(provider, 'gpt-6.1-sol')
  assert.equal(overridden.context.contextWindow, 400_000)
  assert.equal(overridden.defaultMaxTokens, 32_000)
  const custom = await adapter.resolveModel(provider, 'custom-sol')
  assert.equal(custom.name, 'Custom Sol')
  assert.equal(custom.context.contextWindow, 500_000)
  assert.equal(custom.defaultMaxTokens, 64_000)
  assert.deepEqual(custom.inputModalities, ['text', 'image'])
  await collect(adapter.stream({ provider, model: 'custom-sol', messages: [] }))
  assert.equal(body.model, 'custom-sol')
  assert.equal('max_output_tokens' in body, false)
})

