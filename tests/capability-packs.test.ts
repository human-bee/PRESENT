import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Script } from 'node:vm';
import { CAPABILITIES, isCapabilityKind } from '../shared/capabilities';
import { objectSchema } from '../shared/room';
import { RoomStore } from '../server/room-store';
import { isWidgetState } from '../src/widgets/sandbox';
import { createCapability } from '../src/widgets/packs';
import { PACK_STATE_BYTES, recordPatch, records } from '../src/widgets/packs/common';
import { canVerifyClaim } from '../src/widgets/packs/debate-state';
import { diffLines, safeSourceURL } from '../src/widgets/packs/document-state';
import { rollValues, shuffleOrder, standardDeck } from '../src/widgets/packs/game-state';
import { questionStatusPatch, questionVoteCount, questionVotePatch } from '../src/widgets/packs/audience-state';
import { briefActionMetaPatch } from '../src/widgets/packs/brief-state';

test('every capability has isolated initial state, valid render data and room size headroom', () => {
  for (const { kind } of CAPABILITIES) {
    const a = createCapability(kind, 'alice', { x: 12, y: 34 });
    const b = createCapability(kind, 'bob', { x: 0, y: 0 });
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.data.state, b.data.state);
    assert.equal(a.data.capability, kind);
    assert.equal(objectSchema.safeParse(a).success, true);
    assert.equal(a.createdBy, 'alice');
    assert.equal(a.x, 12);
    assert.equal(isWidgetState(a.data.state), true);
    const html = String(a.data.html);
    if (kind === 'captions') { assert.equal(html, '', 'native captions bypass the HTML sandbox'); continue; }
    assert.ok(Buffer.byteLength(JSON.stringify({ ...a, data: { ...a.data, state: {} } })) + PACK_STATE_BYTES < 32_768, kind);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length, `${kind} provides its functional sandbox script`);
    for (const [, source] of scripts) assert.doesNotThrow(() => new Script(source), `${kind} executes as JavaScript`);
    assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write|window\.open|window\.location/);
    assert.doesNotMatch(html, /type=["']submit/, 'sandbox controls cannot rely on native form submission');
    assert.doesNotMatch(html, /getUserMedia|enumerateDevices/, 'these optional instruments do not run a camera sensor');
  }
  assert.equal(isCapabilityKind('kanban'), true);
  assert.equal(isCapabilityKind('unknown'), false);
});

test('per-record patches preserve identity and omit unrelated peer records', () => {
  const state = { 'task:a': { id: 'a', title: 'Draft', owner: 'Alice', status: 'To do' }, 'task:b': { id: 'b', title: 'Review', owner: 'Bob' } };
  const patch = recordPatch(state, 'task', 'a', { status: 'Doing', id: 'unexpected' });
  assert.deepEqual(patch, { 'task:a': { id: 'a', title: 'Draft', owner: 'Alice', status: 'Doing' } });
  assert.deepEqual(records({ ...state, 'task:b': null, 'task:fake': { id: 'wrong' } }, 'task'), [state['task:a']]);
  assert.throws(() => recordPatch({}, '__proto__', 'x', {}));
  assert.throws(() => recordPatch({}, 'task', '../x', {}));
});

test('canonical shallow state merging preserves simultaneous task, score and version operations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-packs-'));
  const store = new RoomStore({ directory });
  const roomId = 'a'.repeat(24);
  const object = createCapability('kanban', 'alice', { x: 0, y: 0 });
  try {
    store.applyOperation(roomId, { type: 'put', object }, 'alice');
    const patch = (actor: string, state: Record<string, unknown>, widgetId = object.id) => store.applyOperation(roomId, { type: 'patch', id: widgetId, patch: { data: { state } } }, actor);
    patch('alice', recordPatch({}, 'task', 'a', { title: 'Draft', owner: 'Alice' }));
    patch('bob', recordPatch({}, 'task', 'b', { title: 'Review', owner: 'Bob' }));
    patch('alice', { 'score:affirmative': 7, 'version:one': { id: 'one', text: 'Before' } });
    patch('bob', { 'score:negative': 8, 'version:two': { id: 'two', text: 'After' } });
    const state = store.getRoom(roomId).objects[0].data.state as Record<string, unknown>;
    assert.equal(records(state, 'task').length, 2);
    assert.equal(records(state, 'version').length, 2);
    assert.equal(state['score:affirmative'], 7);
    assert.equal(state['score:negative'], 8);

    const brief = createCapability('brief', 'alice', { x: 0, y: 0 });
    store.applyOperation(roomId, { type: 'put', object: brief }, 'alice');
    patch('alice', { summary: 'Human summary', ...recordPatch({}, 'action', 'next', { text: 'Human correction' }) }, brief.id);
    patch('bob', { ...briefActionMetaPatch('next', 'owner', 'Bob'), ...briefActionMetaPatch('next', 'status', 'Done') }, brief.id);
    patch('bob', recordPatch({}, 'decision', 'one', { text: 'An additional decision' }), brief.id);
    const briefState = store.getRoom(roomId).objects.find(item => item.id === brief.id)?.data.state as Record<string, unknown>;
    assert.equal(briefState.summary, 'Human summary');
    assert.equal(records(briefState, 'action')[0].text, 'Human correction');
    assert.equal(briefState['owner:next'], 'Bob');
    assert.equal(briefState['status:next'], 'Done');

    const audience = createCapability('audience', 'alice', { x: 0, y: 0 });
    store.applyOperation(roomId, { type: 'put', object: audience }, 'alice');
    const questions = { ...recordPatch({}, 'question', 'one', { text: 'First?' }), ...recordPatch({}, 'question', 'two', { text: 'Second?' }) };
    patch('alice', questions, audience.id);
    patch('alice', questionVotePatch(questions, 'one', 'alice', true) ?? {}, audience.id);
    patch('bob', questionVotePatch(questions, 'one', 'bob', true) ?? {}, audience.id);
    patch('bob', { activeQuestionId: 'two' }, audience.id);
    patch('alice', questionStatusPatch('one', 'resolved'), audience.id);
    const audienceState = store.getRoom(roomId).objects.find(item => item.id === audience.id)?.data.state as Record<string, unknown>;
    assert.equal(questionVoteCount(audienceState, 'one'), 2);
    assert.equal(audienceState.activeQuestionId, 'two');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('document diffs preserve unchanged boundaries and exact user text', () => {
  assert.deepEqual(diffLines('start\nold\nend', 'start\nnew\nend'), [
    { type: 'same', text: 'start' }, { type: 'removed', text: 'old' },
    { type: 'added', text: 'new' }, { type: 'same', text: 'end' },
  ]);
  assert.deepEqual(diffLines('<script>unsafe()</script>', '<script>unsafe()</script>'), [{ type: 'same', text: '<script>unsafe()</script>' }]);
});

test('evidence cannot be marked verified with empty quotes or unsafe sources', () => {
  assert.equal(canVerifyClaim({ quotedEvidence: '', sourceURLs: ['https://example.com'] }), false);
  assert.equal(canVerifyClaim({ quotedEvidence: 'Exact source words', sourceURLs: [] }), false);
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', '/relative', 'https://user:password@example.com']) {
    assert.equal(safeSourceURL(url), null);
    assert.equal(canVerifyClaim({ quotedEvidence: 'Exact source words', sourceURLs: [url] }), false);
  }
  assert.equal(canVerifyClaim({ quotedEvidence: 'Exact source words', sourceURLs: ['https://example.com/evidence'] }), true);
});

test('a full deck has stable unique identities; shuffling only patches ordering', () => {
  const deck = standardDeck();
  const cards = records(deck, 'card');
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards.map((card) => card.label)).size, 52);
  const ids = cards.map((card) => card.id);
  const shuffled = shuffleOrder(ids, Array(51).fill(0));
  assert.equal(Object.keys(shuffled).length, 52);
  assert.deepEqual(Object.values(shuffled).sort((a, b) => a - b), Array.from({ length: 52 }, (_, index) => index));
  assert.ok(Object.keys(shuffled).every((key) => key.startsWith('order:')));
  assert.deepEqual(records({ ...deck, ...shuffled }, 'card'), cards);
});

test('dice rolls include both endpoints without out-of-range or unbounded inputs', () => {
  assert.deepEqual(rollValues(6, [0, 0.5, 0.99999999]), [1, 4, 6]);
  assert.deepEqual(rollValues(20, [0, 0.99999999]), [1, 20]);
  for (const samples of [[-1], [1], [NaN], [], Array(7).fill(0.5)]) assert.throws(() => rollValues(6, samples));
  assert.throws(() => rollValues(7, [0.5]));
});

test('audience votes have one canonical key per participant and cannot clobber peer votes', () => {
  const base = recordPatch({}, 'question', 'topic', { text: 'What comes next?' });
  const alice = questionVotePatch(base, 'topic', 'alice:one', true);
  const bob = questionVotePatch(base, 'topic', 'bob/one', true);
  assert.deepEqual(alice, { 'vote:topic:alice%3Aone': true });
  const merged = { ...base, ...alice, ...bob };
  assert.equal(questionVoteCount(merged, 'topic'), 2);
  assert.equal(questionVoteCount({ ...merged, ...questionVotePatch(merged, 'topic', 'alice:one', true) }, 'topic'), 2);
  assert.equal(questionVoteCount({ ...merged, ...questionVotePatch(merged, 'topic', 'alice:one', false) }, 'topic'), 1);
  assert.equal(questionVoteCount({ ...merged, 'vote:topic:%61lice%3Aone': true, 'vote:topic:': true, 'vote:topic:%ZZ': true }, 'topic'), 2);
  assert.equal(questionVotePatch(base, 'missing', 'alice', true), null);
  assert.equal(questionVotePatch(base, 'topic', '', true), null);
  assert.equal(questionVotePatch({ ...base, ...questionStatusPatch('topic', 'resolved') }, 'topic', 'alice', true), null);
  assert.deepEqual(questionStatusPatch('topic', 'resolved'), { 'questionStatus:topic': 'resolved' });
});

test('meeting action metadata patches leave human text and the summary outside their write scope', () => {
  assert.deepEqual(briefActionMetaPatch('next', 'owner', 'Alice'), { 'owner:next': 'Alice' });
  assert.deepEqual(briefActionMetaPatch('next', 'status', 'Done'), { 'status:next': 'Done' });
  assert.throws(() => briefActionMetaPatch('../next', 'owner', 'Alice'));
  assert.throws(() => briefActionMetaPatch('next', 'owner', 'x'.repeat(81)));
  assert.throws(() => briefActionMetaPatch('next', 'status', 'Unknown'));
});
