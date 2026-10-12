import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OpenAiCodexAdapter } from '../dist/test/adapter.js'
import { CodexModels } from '../dist/test/codex-models.js'
import { toCodexContext } from '../dist/test/context.js'
import { redactedCodexError } from '../dist/test/stream.js'

const provider = 'openai-codex'
const model = 'gpt-6-astra'
const credential = {
  type: 'oauth', access: 'test-only-access', refresh: 'test-only-refresh',
  accountId: 'test-only-account', expires: Number.MAX_SAFE_INTEGER,
}
const usage = { input_tokens: 20, output_tokens: 5, total_tokens: 25,
  input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } }
const itemEvent = (type, index, item) => ({ type: `response.output_item.${type}`, output_index: index, item })
const deltaEvent = (type, index, delta) => ({ type, output_index: index, delta })
async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}

test('native text, reasoning and tools stream and replay through the adapter', async () => {
  const reasoning = { type: 'reasoning', id: 'rs_test', summary: [{ text: 'reason' }] }
  const text = { type: 'message', id: 'msg_test', phase: 'commentary', content: [{ type: 'output_text', text: 'hello' }] }
  const call = { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'test_tool', arguments: '{"ok":true}' }
  const events = [
    { type: 'response.created', response: { id: 'resp_test' } },
    itemEvent('added', 0, reasoning),
    deltaEvent('response.reasoning_summary_text.delta', 0, 'reason'),
    itemEvent('done', 0, reasoning),
    itemEvent('added', 1, text),
    deltaEvent('response.output_text.delta', 1, 'hello'),
    itemEvent('done', 1, text),
    itemEvent('added', 2, { ...call, arguments: '' }),
    deltaEvent('response.function_call_arguments.delta', 2, call.arguments),
    itemEvent('done', 2, call),
    { type: 'response.completed', response: { id: 'resp_test', model, status: 'completed', usage } },
  ]
  let request
  const models = new CodexModels({ read: async () => credential }, {
    refresh: async () => credential,
    fetch: async (_url, init) => {
      request = JSON.parse(init.body)
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
    },
  })
  const adapter = new OpenAiCodexAdapter(models)
  const chunks = await collect(adapter.stream({ provider, model, messages: [] }))
  const blocks = chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block)
  assert.deepEqual(blocks.map(block => block.type), ['reasoning', 'text', 'tool-call'])
  assert.equal(blocks[2].id, 'call_test|fc_test')
  const finish = chunks.at(-1)
  assert.equal(finish.reason.kind, 'tool-calls')
  assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage,
    { inputTokens: 17, outputTokens: 5, cacheReadTokens: 3, reasoningTokens: 2 })
  await collect(adapter.stream({ provider, model, temperature: 0.5, sessionId: 'test-session', messages: [
    { role: 'assistant', content: blocks, source: { kind: 'model', provider, model, replayState: finish.replayState } },
    { role: 'tool', toolCallId: 'call_test|fc_test', content: [{ type: 'text', text: 'done' }] },
  ], tools: [{ name: 'test_tool', description: 'test tool', parameters: { type: 'object' } }] }))
  assert.deepEqual(request.input.map(item => item.type), ['reasoning', 'message', 'function_call', 'function_call_output'])
  assert.deepEqual(request.input[0], reasoning)
  assert.equal(request.input[1].id, 'msg_test')
  assert.equal(request.input[2].call_id, request.input[3].call_id)
  assert.equal(request.tools[0].name, 'test_tool')
  assert.equal(request.temperature, 0.5)
  assert.equal(request.prompt_cache_key, 'test-session')
  assert.equal(models.getModel(provider, model).maxTokens, 128_000)
})

test('context preserves system, user text, tool outputs and tool definitions', async () => {
  const context = await toCodexContext({ provider, model, system: 'instructions', messages: [
    { role: 'system', content: [{ type: 'text', text: 'system' }] },
    { role: 'user', content: [{ type: 'text', text: 'user' }] },
    { role: 'tool', toolCallId: 'call_test', content: [{ type: 'text', text: 'tool text' }] },
  ], tools: [{ name: 'test_tool', description: 'test tool', parameters: { type: 'object' } }] })
  assert.equal(context.systemPrompt, 'instructions')
  assert.equal(context.messages[0].content, 'system')
  assert.equal(context.messages[1].content, 'user')
  assert.equal(context.messages[2].content[0].text, 'tool text')
  assert.equal(context.tools[0].name, 'test_tool')
})

for (const [raw, code] of [
  ['No API key private-detail', 'MISSING_CREDENTIAL'],
  ['401 private-detail', 'AUTH'],
  ['429 private-detail', 'RATE_LIMIT'],
  ['billing private-detail', 'QUOTA_EXCEEDED'],
  ['timeout private-detail', 'TIMEOUT'],
  ['fetch private-detail', 'TRANSPORT'],
  ['private-detail', 'CODEX_ERROR'],
]) {
  test(`unknown provider errors redact sensitive details (${code})`, () => {
    const error = redactedCodexError(new Error(raw))
    assert.equal(error.code, code)
    assert.ok(!error.message.includes('private-detail'))
    assert.equal(error.cause, undefined)
  })
}
