import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CAPABILITIES } from '../shared/capabilities';
import { evidenceReportSchema, providerRequestSchema } from '../shared/evidence';
import { VOICE_TOOL_NAMES } from '../shared/voice-tool-names';
import { workRequestSchema } from '../shared/work';
import { executeVoiceTool, voiceRequestSchema, voiceTools, type VoiceToolDependencies } from '../server/agents/voice-tools';
import { VoiceOwnership } from '../server/agents/voice-ownership';
import { RoomStore } from '../server/room-store';
import { createRealtimeEvents } from '../src/voice/realtime-events';

const roomId = 'e'.repeat(32), actor = 'voice-human', sessionId = 'voice-session-direct';
const request = (name: string, args: unknown, callId = `call_${name}`) => ({ roomId, actor, sessionId, callId, name, arguments: args });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'present-voice-tools-'));
  const store = new RoomStore({ directory, legacyDirectory: join(directory, 'legacy') });
  const dependencies: VoiceToolDependencies = { getRoom: store.getRoom.bind(store), getCanvasRecords: store.getCanvasRecords.bind(store), applyOperation: store.applyOperation.bind(store), research: async () => { throw new Error('Unexpected research'); }, image: async () => { throw new Error('Unexpected image generation'); }, work: () => { throw new Error('Unexpected work generation'); } };
  return { store, dependencies, run: (name: string, args: unknown) => executeVoiceTool(request(name, args), undefined, dependencies), close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('one shared Realtime tool list drives server schemas and client dispatch', async () => {
  assert.deepEqual(voiceTools.map(tool => tool.name), [...VOICE_TOOL_NAMES]);
  const executed: string[] = [], sent: unknown[] = [];
  const events = createRealtimeEvents({ current: () => true, mode: () => 'ambient', send: event => sent.push(event), execute: async name => { executed.push(name); return {}; }, status: () => {}, record: () => {}, error: error => { throw error; } });
  for (const [index, name] of VOICE_TOOL_NAMES.entries()) {
    assert.ok(voiceRequestSchema.safeParse(request(name, {})).success);
    await events({ type: 'response.event', delegation_id: 'd', event: { type: 'response.created', response: { id: `response-${index}` } } });
    await events({ type: 'response.event', delegation_id: 'd', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: `call-${index}`, name, arguments: '{}' } } });
    await events({ type: 'response.event', delegation_id: 'd', event: { type: 'response.completed', response: { id: `response-${index}`, output: [] } } });
  }
  assert.deepEqual(executed, [...VOICE_TOOL_NAMES]); assert.ok(sent.length >= VOICE_TOOL_NAMES.length);
});

test('a short timer tool call uses the listening viewport while explicit coordinates stay authoritative', async () => {
  const f = fixture();
  try {
    const timerTool = voiceTools.find(tool => tool.name === 'set_timer'); assert.ok(timerTool);
    assert.deepEqual(timerTool.parameters.required, ['seconds']);
    const position = { x: 580, y: 330 };
    const first = await executeVoiceTool({ ...request('set_timer', { seconds: 120 }), position }, undefined, f.dependencies) as { objectId: string };
    const timer = f.store.getRoom(roomId).objects.find(object => object.id === first.objectId); assert.ok(timer);
    assert.equal(timer.x, position.x); assert.equal(timer.y, position.y); assert.ok(Number(timer.data.endsAt) > Date.now());
    const second = await executeVoiceTool({ ...request('set_timer', { seconds: 60, x: 100, y: 200 }, 'explicit'), position }, undefined, f.dependencies) as { objectId: string };
    const explicit = f.store.getRoom(roomId).objects.find(object => object.id === second.objectId); assert.ok(explicit);
    assert.equal(explicit.x, 100); assert.equal(explicit.y, 200);
  } finally { f.close(); }
});

test('capabilities, video, timers and notes use direct room mutations with owned-call deduplication', async () => {
  const f = fixture();
  try {
    const ownership = new VoiceOwnership(); ownership.begin(roomId, actor, sessionId); ownership.activate(roomId, sessionId);
    const call = request('add_capability', { capability: 'kanban', title: 'Next steps', items: [{ text: 'Interview users', owner: 'Maya' }], x: 30, y: 40 });
    const execute = () => executeVoiceTool(call, undefined, f.dependencies);
    await Promise.all([ownership.runTool(call, execute), ownership.runTool(call, execute)]);
    const board = f.store.getRoom(roomId).objects[0], tasks = Object.values(board.data.state as Record<string, { owner: string; status: string }>);
    assert.equal(f.store.getRoom(roomId).objects.length, 1); assert.equal(tasks[0].owner, 'Maya'); assert.equal(tasks[0].status, 'To do');
    for (const capability of CAPABILITIES) await f.run('add_capability', { capability: capability.kind });
    await f.run('add_video', { url: 'https://youtu.be/dQw4w9WgXcQ?t=42' });
    await f.run('set_timer', { seconds: 120, title: 'Rebuttal' }); await f.run('add_note', { text: 'Remember the question' });
    const objects = f.store.getRoom(roomId).objects;
    assert.ok(objects.find(object => object.data.capability === 'youtube' && object.data.startSeconds === 42));
    assert.ok(objects.find(object => object.kind === 'timer' && object.data.durationMs === 120000));
    await assert.rejects(f.run('add_video', { url: 'https://evil.example/not-youtube' }), /valid YouTube/);
  } finally { f.close(); }
});

test('research is called directly and remains a model assessment without verifying an existing claim', async () => {
  const f = fixture(); let calls = 0;
  try {
    await f.run('add_capability', { capability: 'debate', items: [{ text: 'The Eiffel Tower is in Berlin', side: 'Affirmative' }] });
    const card = f.store.getRoom(roomId).objects[0];
    f.dependencies.research = async raw => {
      const input = providerRequestSchema.parse(raw); calls++; assert.deepEqual(input.selection, [card.id]); assert.equal(input.actor, actor); assert.match(input.requestId, /^voice:/);
      const evidence = evidenceReportSchema.parse({ question: input.prompt, status: 'model-assessment', coverage: 'no-citable-sources', model: 'test-model', responseId: 'test-response', retrievedAt: 100, modelAssessment: { text: 'This mock has no verified source.', citations: [] }, sources: [], consultedSources: [] });
      return { objectId: 'research-card', model: evidence.model, responseId: evidence.responseId, elapsedMs: 1, evidence };
    };
    const result = await f.run('research_sources', { question: 'Check this claim', selection: [card.id] }) as { assessmentStatus: string; verification: string };
    assert.equal(calls, 1); assert.equal(result.assessmentStatus, 'model-assessment'); assert.equal(result.verification, 'not-human-verified');
    assert.equal(Object.values(f.store.getRoom(roomId).objects[0].data.state as Record<string, { status: string }>).filter(value => typeof value === 'object')[0].status, 'pending');
  } finally { f.close(); }
});

test('image generation requires explicit reference IDs and forwards only those references', async () => {
  const f = fixture(); const references: string[][] = [];
  f.dependencies.image = async raw => { const input = providerRequestSchema.parse(raw); references.push(input.selection); return { objectId: 'image', src: '/api/assets/test.png', model: 'test', width: 10, height: 10, generatedAt: 0, elapsedMs: 1 }; };
  try {
    await assert.rejects(f.run('generate_image', { prompt: 'Make a cover' }), /precise details/);
    await assert.rejects(f.run('generate_image', { prompt: 'Make a cover', referenceIds: ['one', 'one'] }), /precise details/);
    await f.run('generate_image', { prompt: 'Make a cover', referenceIds: [] });
    await f.run('generate_image', { prompt: 'Use this image', referenceIds: ['selected-image'] });
    assert.deepEqual(references, [[], ['selected-image']]);
  } finally { f.close(); }
});

test('start_work preserves the human owner and reports queued work rather than a finished artifact', async () => {
  const f = fixture(); let calls = 0;
  f.dependencies.work = raw => { const input = workRequestSchema.parse(raw); calls++; assert.equal(input.owner, 'Maya'); assert.equal(input.actor, actor); assert.equal(input.provider, 'luna'); assert.deepEqual(input.position, { x: 12, y: 34 }); return { ...input, owner: input.owner ?? '', title: input.title, jobId: 'a'.repeat(32), objectId: 'existing-work', status: 'queued', attempt: 0, createdAt: 0, startedAt: null, completedAt: null, error: null, artifactIds: [] }; };
  try {
    const result = await f.run('start_work', { prompt: 'Write the launch brief', owner: 'Maya', objectId: 'existing-work', x: 12, y: 34 }) as { status: string; completionBoundary: string };
    assert.equal(result.status, 'queued'); assert.equal(result.completionBoundary, 'job-accepted');
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(executeVoiceTool(request('start_work', { prompt: 'Do not start', owner: 'Maya' }), cancelled.signal, f.dependencies)); assert.equal(calls, 1);
  } finally { f.close(); }
});

test('read_room returns bounded current state and provenance only when requested, with explicit truncation', async () => {
  const f = fixture();
  try {
    await f.run('add_capability', { capability: 'debate', items: [{ text: 'Check our claim', owner: 'Maya' }] });
    const card = f.store.getRoom(roomId).objects[0];
    f.store.applyOperation(roomId, { type: 'patch', id: card.id, patch: { data: { provenance: { status: 'model-assessment' }, context: 'x'.repeat(8000) } } }, actor);
    const brief = await f.run('read_room', {}) as { objects: Record<string, unknown>[] }; assert.equal(brief.objects[0].data, undefined);
    const detailed = await f.run('read_room', { ids: [card.id], includeData: true }) as { objects: { data: Record<string, unknown>; dataTruncated: boolean; contentTrust: string }[] };
    assert.equal(detailed.objects.length, 1); assert.ok(Buffer.byteLength(JSON.stringify(detailed.objects[0].data)) <= 3800); assert.equal(detailed.objects[0].dataTruncated, true);
    assert.deepEqual(detailed.objects[0].data.provenance, { status: 'model-assessment' }); assert.ok(detailed.objects[0].data.state); assert.equal(detailed.objects[0].contentTrust, 'untrusted-room-data');
    await assert.rejects(f.run('read_room', { ids: ['missing'], includeData: true }), /no longer exists/);
  } finally { f.close(); }
});

test('detailed room context includes only a bounded recent transcript and does not identify mixed-audio speakers', async () => {
  const f = fixture();
  try {
    const transcript = Array.from({ length: 22 }, (_, index) => ({ id: `turn-${index}`, role: index === 21 ? 'assistant' : 'user', text: index === 2 ? 'Long discussion '.repeat(100) : `Discussion ${index}`, at: index, source: 'room-voice' }));
    f.store.mutateCanvas(roomId, { documentMeta: { present: { transcript } } }, actor);
    const brief = await f.run('read_room', {}) as Record<string, unknown>; assert.equal(brief.recentTranscript, undefined);
    const detail = await f.run('read_room', { includeData: true }) as { recentTranscript: { id: string; role: string; speaker: string; text: string; textTruncated: boolean }[]; transcriptTruncated: boolean; contentTrust: string };
    assert.equal(detail.recentTranscript.length, 20); assert.equal(detail.recentTranscript[0].id, 'turn-2');
    assert.equal(detail.recentTranscript[0].speaker, 'mixed-room-audio'); assert.equal(detail.recentTranscript[0].role, 'user');
    assert.equal(detail.recentTranscript[0].text.length, 600); assert.equal(detail.recentTranscript[0].textTruncated, true);
    assert.equal(detail.recentTranscript[19].speaker, 'PRESENT assistant'); assert.equal(detail.transcriptTruncated, true); assert.equal(detail.contentTrust, 'untrusted-room-data');
  } finally { f.close(); }
});

test('detailed room reads expose only bounded selected MCP app context as untrusted data', async () => {
  const f = fixture();
  try {
    await f.run('add_capability', { capability: 'document' }); const card = f.store.getRoom(roomId).objects[0];
    f.dependencies.readMcpContexts = () => [{ roomId, objectId: card.id, updatedAt: 123, contentTrust: 'untrusted-mcp-app', context: { content: [{ type: 'text', text: 'x'.repeat(8000) }] } }, { roomId, objectId: 'not-selected', updatedAt: 124, contentTrust: 'untrusted-mcp-app', context: { content: [] } }];
    const compact = await f.run('read_room', {}) as Record<string, unknown>; assert.equal(compact.mcpAppContexts, undefined);
    const detail = await f.run('read_room', { ids: [card.id], includeData: true }) as { mcpAppContexts: { objectId: string; contentTrust: string; data: unknown; dataTruncated: boolean }[] };
    assert.equal(detail.mcpAppContexts.length, 1); assert.equal(detail.mcpAppContexts[0].objectId, card.id); assert.equal(detail.mcpAppContexts[0].contentTrust, 'untrusted-mcp-app');
    assert.ok(Buffer.byteLength(JSON.stringify(detail.mcpAppContexts[0].data)) <= 3800); assert.equal(detail.mcpAppContexts[0].dataTruncated, true);
  } finally { f.close(); }
});

test('room recall searches full saved content and pages beyond bounded summaries', async () => {
  const f = fixture();
  try {
    await f.run('add_note', { text: 'x'.repeat(4500) + ' unique-recall-marker' });
    const result = await f.run('recall_room', { source: 'objects', query: 'unique-recall-marker', limit: 1 }) as { items: { id: string; content: string; nextContentOffset: number }[]; nextOffset: number | null };
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].content.length, 4000);
    assert.equal(result.items[0].nextContentOffset, 4000);
    const rest = await f.run('recall_room', { source: 'objects', id: result.items[0].id, contentOffset: 4000 }) as { items: { content: string; nextContentOffset: null }[] };
    assert.match(rest.items[0].content, /unique-recall-marker/);
    assert.equal(rest.items[0].nextContentOffset, null);
    const missing = await f.run('recall_room', { source: 'objects', query: 'absent-marker' }) as { totalMatches: number };
    assert.equal(missing.totalMatches, 0);
  } finally { f.close(); }
});
