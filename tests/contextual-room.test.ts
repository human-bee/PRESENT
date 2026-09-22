import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ActivityEngine } from '../server/activities/engine';
import { RoomStore } from '../server/room-store';
import { NativeActivities } from '../server/activities/activity-store';
import { ActivityAuthority } from '../server/activities/authority';
import { applyInterpretation } from '../server/activities/apply-interpretation';
import { appendUtterance, changeTopic } from '../server/activities/activity-mutations';
import { makeActivity, type ActivityCommand } from '../shared/activity';
import { emptyPlan, type ConversationPlan, type ResolutionVerdict } from '../shared/conversation-plan';
import { validateDataset } from '../server/activities/research-comparison';
import type { WorkJob } from '../shared/work';

const room = 'c8'.repeat(16);
const waitTick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(plan: (text: string) => ConversationPlan, verify?: (text: string, blocker: string) => Promise<ResolutionVerdict>) {
  const directory = mkdtempSync(join(tmpdir(), 'context-room-')), store = new RoomStore({ directory }), native = new NativeActivities(store);
  let starts = 0, verifies = 0, cancelled = 0, count = 0;
  const job: WorkJob = { jobId: 'cd'.repeat(16), roomId: room, objectId: 'fixture-work', requestId: 'fixture', actor: 'riley', owner: 'riley', title: 'Parser', prompt: 'Build parser', provider: 'spark', status: 'running', attempt: 1, createdAt: 1, startedAt: 1, completedAt: null, error: null, artifactIds: [] };
  const engine = new ActivityEngine(store, { extract: async (_a, u) => ({ plan: plan(u.text), model: 'fixture-context', responseId: u.id }),
    verify: async (_a, u, id) => { verifies++; return verify ? verify(u.text, id) : { decision: 'confirm', blockerId: id, quote: u.text, reason: 'Fixture independent interpretation' }; } },
    { authority: new ActivityAuthority(directory, Buffer.alloc(32, 4)), profile: async () => { throw new Error('Not used'); }, start: () => { starts++; return job; }, get: () => job, cancel: () => { cancelled++; job.status = 'cancelled'; return job; } });
  const { activityId } = engine.launch({ roomId: room, actor: 'alex', requestId: 'launch', kind: 'standup' });
  const act = (command: ActivityCommand, actor = 'alex') => engine.act({ roomId: room, activityId, actor, requestId: `r-${++count}`, command });
  const a = () => engine.read(room).activities[0];
  act({ type: 'seat', name: 'Alex', sideId: null }); act({ type: 'seat', name: 'Riley', sideId: null }, 'riley');
  act({ type: 'blocker', title: 'Export contract', ownerId: 'alex' });
  act({ type: 'commitment', title: 'Parser', prompt: 'Build parser', ownerId: 'riley', blockedBy: [a().meeting.blockers[0].id] }, 'riley');
  act({ type: 'authorize-work', commitmentId: a().meeting.commitments[0].id }, 'riley');
  return { engine, act, a, native, activityId, counts: () => ({ starts, verifies, cancelled }), close: async () => { engine.close(); await engine.settled(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function resolutionPlan(text: string, blockerId: string, intent: 'completed' | 'retracted' | 'uncertain' = 'completed', grounding: 'speaker' | 'quoted' = 'speaker'): ConversationPlan {
  return { ...emptyPlan(), resolutions: [{ blockerId, quote: text, intent, grounding }] };
}

test('contextual subjects preserve preferences and quotes; invalid references do not create replacement targets', () => {
  const a = makeActivity('debate', 'alex', 'activity'); a.autoResearch = false;
  a.seats.push({ actor: 'alex', name: 'Alex', sideId: null });
  appendUtterance(a, { id: 'one', text: 'I prefer copper pans to steel ones.', source: 'typed', speakerId: 'alex', speakerName: 'Alex', sideId: null, at: 1 });
  const u = a.utterances[0], plan = { ...emptyPlan(), contributions: [{ kind: 'preference' as const, text: 'Alex prefers copper pans.', quote: u.text, subject: 'Copper pans', replacesClaimId: null }], comparisons: [{ title: 'Copper and steel', quote: u.text, subjects: [{ label: 'Copper pans', query: 'copper pan', sideId: null }, { label: 'Steel pans', query: 'steel pan', sideId: null }], dataQuestion: null }] };
  applyInterpretation(a, u, { plan, model: 'fixture', responseId: '1' }, 1);
  assert.equal(a.claims.length, 0); assert.equal(a.visuals.length, 2); assert.equal(a.seats[0].sideId, a.sides[0].id); assert.equal(a.observations[0].source.quote, u.text);
  const before = a.sides.length;
  applyInterpretation(a, u, { plan: { ...emptyPlan(), comparisons: [{ ...plan.comparisons[0], subjects: [{ label: 'Invented', query: 'nothing', sideId: 'missing' }] }], contributions: [{ kind: 'claim', text: 'Bad update', quote: u.text, subject: null, replacesClaimId: 'missing' }] }, model: 'fixture', responseId: '2' }, 1);
  assert.equal(a.sides.length, before); assert.equal(a.claims.length, 0);
  applyInterpretation(a, u, { plan: { ...emptyPlan(), contributions: [{ kind: 'claim', text: 'Ungrounded', quote: 'Words never spoken', subject: null, replacesClaimId: null }] }, model: 'fixture', responseId: '3' }, 1);
  assert.equal(a.claims.length, 0); changeTopic(a, 'Camping equipment'); assert.equal(a.epoch, 1); assert.ok(a.visuals.every(v => v.epoch === 0));
});

test('known spoken owner resolution dispatches once; shared or forged speech cannot authorize it', async () => {
  let blocker = ''; const s = setup(text => resolutionPlan(text, blocker)); blocker = s.a().meeting.blockers[0].id;
  try {
    s.engine.ingestVoice(room, 'shared-session', { id: 'shared', text: 'I completed it.', role: 'user' }); await s.engine.settled(); assert.equal(s.counts().starts, 0);
    s.act({ type: 'say', text: 'Oh I actually completed that yesterday, that should be unblocked now.' }); await s.engine.settled(); assert.equal(s.counts().starts, 1);
    s.engine.ingestVoice(room, 'personal-session', { id: 'done', text: 'It is completed.', role: 'user' }, { actor: 'alex', name: 'Alex', capture: 'personal' }); await s.engine.settled(); assert.equal(s.counts().starts, 1);
  } finally { await s.close(); }
});

test('a new owner statement arriving during verification invalidates the old resolution', async () => {
  let blocker = ''; const pending = deferred<ResolutionVerdict>();
  const s = setup(text => text === 'First completion' ? resolutionPlan(text, blocker) : emptyPlan(), () => pending.promise); blocker = s.a().meeting.blockers[0].id;
  try {
    s.act({ type: 'say', text: 'First completion' }); for (let i = 0; i < 8 && !s.counts().verifies; i++) await waitTick();
    assert.equal(s.counts().verifies, 1); s.act({ type: 'say', text: 'Wait, that is not finished.' });
    pending.resolve({ decision: 'confirm', blockerId: blocker, quote: 'First completion', reason: 'Fixture stale interpretation' }); await s.engine.settled();
    assert.equal(s.counts().starts, 0); assert.equal(s.a().resolutionSuggestions[0].status, 'stale');
  } finally { await s.close(); }
});

test('tampered transcript proof and changed dependency definitions cannot start authorized work', async () => {
  let blocker = ''; const pending = deferred<ResolutionVerdict>(); const s = setup(text => resolutionPlan(text, blocker), () => pending.promise); blocker = s.a().meeting.blockers[0].id;
  try {
    s.act({ type: 'say', text: 'Done' }); for (let i = 0; i < 8 && !s.counts().verifies; i++) await waitTick();
    s.native.update(room, s.activityId, a => { a.utterances[0].text = 'Forged completion'; });
    pending.resolve({ decision: 'confirm', blockerId: blocker, quote: 'Done', reason: 'Fixture' }); await s.engine.settled(); assert.equal(s.counts().starts, 0);
    s.native.update(room, s.activityId, a => { a.meeting.blockers[0].title = 'Different prerequisite'; });
    s.act({ type: 'resolve-blocker', blockerId: blocker, text: 'Explicit owner confirmation' }); assert.equal(s.counts().starts, 0);
  } finally { await s.close(); }
});

test('quoted or rejected interpretation stays reviewable; retraction cancels conditional work', async () => {
  let blocker = ''; const s = setup(text => resolutionPlan(text, blocker, text === 'Retracted' ? 'retracted' : 'completed', text === 'Quoted' ? 'quoted' : 'speaker'), async (text, id) => ({ decision: text === 'Retracted' ? 'retract' : text === 'Uncertain' ? 'review' : 'confirm', blockerId: id, quote: text, reason: 'Fixture interpretation' })); blocker = s.a().meeting.blockers[0].id;
  try {
    for (const text of ['Quoted', 'Uncertain']) { s.act({ type: 'say', text }); await s.engine.settled(); } assert.equal(s.counts().starts, 0);
    s.act({ type: 'say', text: 'Done' }); await s.engine.settled(); assert.equal(s.counts().starts, 1);
    s.act({ type: 'say', text: 'Retracted' }); await s.engine.settled(); assert.equal(s.counts().cancelled, 1); assert.equal(s.a().meeting.blockers[0].status, 'open');
  } finally { await s.close(); }
});

test('dataset validation preserves literal numbers and rejects invented, overquoted or incomparable data', () => {
  const pages = [{ id: '1', url: 'https://example.com/source', title: 'Fixture source', text: 'Main span 4,200 ft. One side span 1,125 ft.', sha256: 'fixture' }];
  const data = { comparable: true, title: 'Spans', unit: 'ft', scope: 'Same fixture structure', rows: [{ label: 'Main', valueText: '4,200', unitText: 'ft', unitQuote: 'ft', sourceId: '1', quote: 'Main span 4,200 ft.', cohort: 'Main span' }, { label: 'Side', valueText: '1,125', unitText: 'ft', unitQuote: 'ft', sourceId: '1', quote: 'One side span 1,125 ft.', cohort: 'One side span' }], caveats: [], reason: '' };
  assert.deepEqual(validateDataset(data, pages)?.map(r => r.value), [4200, 1125]);
  assert.equal(validateDataset({ ...data, comparable: false }, pages), null);
  assert.equal(validateDataset({ ...data, unit: 'days' }, pages), null);
  assert.equal(validateDataset({ ...data, rows: [{ ...data.rows[0], valueText: '4,2' }, data.rows[1]] }, pages), null);
  assert.equal(validateDataset({ ...data, rows: [{ ...data.rows[0], valueText: '4201' }, data.rows[1]] }, pages), null);
  assert.equal(validateDataset({ ...data, rows: [{ ...data.rows[0], quote: 'Invented 4,200 ft.' }, data.rows[1]] }, pages), null);
});
