import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCompletionStream } from '../server/agents/completion-stream';
import { generationRequestSchema } from '../server/agents/contract';
const response = (chunks: string[]) => new Response(new ReadableStream({start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); }}));
test('SSE handles split packets and excludes reasoning from canvas deltas', async () => {
  const chunks: string[] = [];
  const r = response(['data: {"choices":[{"delta":{"reasoning":"private"}}]}\n\ndata: {"choices":[{"delta":{"cont', 'ent":"hello"}}]}\r\n\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n']);
  assert.equal(await readCompletionStream(r, s => chunks.push(s)), 'hello world');
  assert.deepEqual(chunks, ['hello', ' world']);
});
test('SSE rejects truncated and interrupted completions', async () => {
  await assert.rejects(readCompletionStream(response(['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n']), () => {}), /incomplete/);
  await assert.rejects(readCompletionStream(response(['data: {"choices":[{"delta":{"content":"partial"}}]}\n']), () => {}), /before/);
});
test('a complete generated scene can be selected for a follow-up request', () => {
  const value = { roomId: 'a'.repeat(32), provider: 'luna', prompt: 'Change this scene', position: { x: 0, y: 0 }, selection: Array.from({ length: 80 }, (_, i) => `node_${i}`) };
  assert.equal(generationRequestSchema.safeParse(value).success, true);
  assert.equal(generationRequestSchema.safeParse({ ...value, selection: Array(201).fill('node') }).success, false);
});
