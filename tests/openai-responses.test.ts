import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { agentModels } from '../shared/agent-models';
import { completedResponseText, generateWithOpenAI, openAIAvailability, readResponsesStream } from '../server/agents/openai-responses';
import { generateWithCodex } from '../server/agents/codex';

function configure(t: TestContext) {
  const previous = { key: process.env.OPENAI_API_KEY, transport: process.env.PRESENT_MODEL_TRANSPORT };
  process.env.OPENAI_API_KEY = `unit-test-not-a-key-${Math.random()}`;
  process.env.PRESENT_MODEL_TRANSPORT = 'openai';
  t.after(() => { for (const [name, value] of [['OPENAI_API_KEY', previous.key], ['PRESENT_MODEL_TRANSPORT', previous.transport]]) { if (value === undefined) delete process.env[name!]; else process.env[name!] = value; } });
}
const completed = (text = '{"ok":true}') => ({ model: agentModels.luna, status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });
const sse = (events: unknown[]) => events.map(event => `event: ignored\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('');
function chunks(text: string, size = 7) {
  const bytes = new TextEncoder().encode(text); let offset = 0;
  return new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) controller.close(); else { controller.enqueue(bytes.slice(offset, offset + size)); offset += size; } } }));
}
test('explicit API transport preserves exact model, schema, image context and paid tier choice without host tools', async t => {
  configure(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, agentModels.luna); assert.equal(body.store, false); assert.equal(body.stream, false);
    assert.equal(body.service_tier, 'fast'); assert.deepEqual(body.tools, []); assert.equal(body.max_output_tokens, 20000);
    assert.deepEqual(body.text.format, { type: 'json_schema', name: 'present_result', strict: true, schema: { type: 'object' } });
    assert.equal(body.instructions, 'Trusted instructions'); assert.equal(body.input[0].role, 'user');
    assert.equal(body.input[0].content[0].text, 'Untrusted room content'); assert.equal(body.input[0].content[1].type, 'input_image');
    return Response.json(completed());
  });
  assert.equal(await generateWithCodex('Untrusted room content', new AbortController().signal, 'luna', { instructions: 'Trusted instructions', outputSchema: { type: 'object' }, image: 'data:image/png;base64,dGVzdA==' }, { fast: true, reasoning: 'low' }), '{"ok":true}');
  assert.equal(calls, 1);
});
test('API generation never silently enables paid transport, changes model or accepts unsupported effort', async t => {
  configure(t); let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Should not fetch'); });
  const signal = new AbortController().signal;
  process.env.PRESENT_MODEL_TRANSPORT = 'codex'; await assert.rejects(generateWithOpenAI('x', signal), /explicit/);
  process.env.PRESENT_MODEL_TRANSPORT = 'openai'; delete process.env.OPENAI_API_KEY; await assert.rejects(generateWithOpenAI('x', signal), /not configured/);
  process.env.OPENAI_API_KEY = 'unit-test'; await assert.rejects(generateWithOpenAI('x', signal, 'spark'), /Spark/);
  await assert.rejects(generateWithOpenAI('x', signal, 'codex', undefined, { reasoning: 'none' }), /reasoning effort/);
  await assert.rejects(generateWithOpenAI('x', AbortSignal.abort()), /abort/i); assert.equal(calls, 0);
});
test('terminal output rejects refusal, truncation, different models and unexpected tool calls', () => {
  assert.equal(completedResponseText(completed(), agentModels.luna), '{"ok":true}');
  assert.equal(completedResponseText({ ...completed(), model: `${agentModels.luna}-2026-06-01` }, agentModels.luna), '{"ok":true}');
  for (const response of [{ ...completed(), model: agentModels.codex }, { ...completed(), status: 'incomplete' }, { ...completed(), output: [{ type: 'function_call' }] }, { ...completed(), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }] }] }]) assert.throws(() => completedResponseText(response, agentModels.luna));
});
test('split UTF-8 SSE renders only text deltas and requires a validated completed event', async () => {
  const deltas: string[] = [];
  const events = [{ type: 'response.reasoning_summary_text.delta', delta: 'Private reasoning' }, { type: 'response.output_text.delta', delta: '{"word":"café"}' }, { type: 'response.completed', response: completed('{"word":"café"}') }];
  assert.equal(await readResponsesStream(chunks(sse(events), 1), agentModels.luna, text => deltas.push(text)), '{"word":"café"}');
  assert.deepEqual(deltas, ['{"word":"café"}']);
  await assert.rejects(readResponsesStream(chunks(sse(events.slice(0, 2))), agentModels.luna, () => {}), /incomplete/);
  for (const type of ['error', 'response.failed', 'response.incomplete', 'response.refusal.done']) await assert.rejects(readResponsesStream(chunks(sse([{ type }])), agentModels.luna, () => {}));
});
test('HTTP errors never disclose upstream bodies or credentials', async t => {
  configure(t);
  for (const status of [401, 403, 429, 500]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response('sensitive upstream account detail', { status }));
    await assert.rejects(generateWithOpenAI('x', new AbortController().signal), (error: Error & { status?: number }) => { assert.doesNotMatch(error.message, /sensitive|unit-test/); assert.equal(error.status, [401, 403].includes(status) ? 424 : status === 429 ? 429 : 502); return true; }); mock.mock.restore();
  }
});
test('model discovery is bounded, cached and reports actual project visibility without launching Codex', async t => {
  configure(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls++; assert.equal(url, 'https://api.openai.com/v1/models'); return Response.json({ data: [{ id: agentModels.luna }, { id: agentModels.spark }, { id: 'other-model' }] }); });
  const [a, b] = await Promise.all([openAIAvailability(), openAIAvailability()]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  assert.deepEqual(a.providers.filter(provider => provider.configured).map(provider => provider.id), ['luna']);
  assert.equal(a.providers.find(provider => provider.id === 'spark')?.configured, false);
});
test('oversized or unterminated streams stop without accepting partial output', async () => {
  await assert.rejects(readResponsesStream(chunks('data: ' + 'x'.repeat(2_000_001), 65536), agentModels.luna, () => {}), /size limit/);
  await assert.rejects(readResponsesStream(chunks(sse([{ type: 'response.output_text.delta', delta: 'x'.repeat(400001) }]), 65536), agentModels.luna, () => {}), /incomplete/);
});
