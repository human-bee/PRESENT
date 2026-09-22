import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RoomStore } from '../server/room-store';
import { createAppendTranscript } from '../server/agents/transcript';
import { MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPT_ENTRIES, readTranscript, readTranscriptWindow, retainTranscript, type TranscriptEntry } from '../shared/transcript';
import { makeObject } from '../shared/room';
import { DocumentRecordType } from '@tldraw/tlschema';

const caption = (id: number, text = 'A saved final caption.'): TranscriptEntry => ({ id: `item_${id}`, role: 'user', text, at: id, source: 'room-voice' });

test('final captions preserve native work, deduplicate and survive an immediate restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-captions-'));
  let store = new RoomStore({ directory });
  const roomId = 'abcdef0123456789abcdef0123456789';
  try {
    const note = makeObject('note', 'human', { x: 10, y: 20 }, { text: 'Keep my correction.' });
    store.applyOperation(roomId, { type: 'put', object: note }, 'human', { requestId: 'human-note' });
    const append = createAppendTranscript(store.transactCanvas.bind(store));
    append(roomId, 'listener', 'session_one', { id: 'item_a', role: 'user', text: 'I will draft the launch brief.' });
    append(roomId, 'listener', 'session_one', { id: 'item_b', role: 'assistant', text: 'The work card is queued.' });
    const before = store.getRoom(roomId).revision;
    append(roomId, 'listener', 'session_one', { id: 'item_a', role: 'user', text: 'I will draft the launch brief.' });
    assert.equal(store.getRoom(roomId).revision, before);
    assert.throws(() => append(roomId, 'listener', 'session_one', { id: 'item_a', role: 'user', text: 'Different text.' }), /Request ID/);
    assert.equal(readTranscript(store.getCanvasRecords(roomId)).length, 2);
    store.close(); store = new RoomStore({ directory });
    const captions = readTranscript(store.getCanvasRecords(roomId));
    assert.deepEqual(captions.map(item => [item.id, item.role, item.text]), [['item_a', 'user', 'I will draft the launch brief.'], ['item_b', 'assistant', 'The work card is queued.']]);
    assert.equal(store.getRoom(roomId).objects[0].data.text, 'Keep my correction.');
    assert.equal(store.getRoom(roomId).events.length, 3);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('caption retention keeps a contiguous newest window within both count and serialized UTF-8 byte limits', () => {
  const short = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 7 }, (_, index) => caption(index));
  const countWindow = retainTranscript(short);
  assert.equal(countWindow.entries.length, MAX_TRANSCRIPT_ENTRIES);
  assert.equal(countWindow.omitted, 7);
  assert.deepEqual(countWindow.entries, short.slice(7));
  for (const text of ['🌱'.repeat(3000), '\u0001'.repeat(6000)]) {
    const long = Array.from({ length: 30 }, (_, index) => caption(index, text));
    const window = retainTranscript(long);
    assert.ok(window.omitted > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(window.entries), 'utf8') <= MAX_TRANSCRIPT_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(long.slice(window.omitted - 1)), 'utf8') > MAX_TRANSCRIPT_BYTES);
    assert.deepEqual(window.entries, long.slice(window.omitted));
  }
});

test('bounded reads disclose omitted captions instead of treating the retained window as complete history', () => {
  const entries = Array.from({ length: 501 }, (_, index) => caption(index));
  const document = DocumentRecordType.create({ meta: { present: { transcript: [{ ...caption(999), text: '' }, ...entries], transcriptOmitted: 7 } } });
  const window = readTranscriptWindow([document]);
  assert.deepEqual(window.entries, entries.slice(1));
  assert.equal(window.omitted, 9);
  assert.deepEqual(readTranscript([document]), window.entries);
});

test('appending long captions prunes old entries and persists explicit retention metadata with native work intact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-caption-limit-'));
  let store = new RoomStore({ directory });
  const roomId = 'f'.repeat(32), text = '🌱'.repeat(3000);
  try {
    const note = makeObject('note', 'human', { x: 10, y: 20 }, { text: 'Keep the canvas.' });
    store.applyOperation(roomId, { type: 'put', object: note }, 'human');
    const append = createAppendTranscript(store.transactCanvas.bind(store));
    for (let index = 0; index < 35; index++) append(roomId, 'listener', 'bounded_session', { id: `item_${index}`, role: 'user', text });
    const records = store.getCanvasRecords(roomId);
    const window = readTranscriptWindow(records);
    assert.ok(window.omitted > 0);
    assert.equal(window.entries.length + window.omitted, 35);
    assert.deepEqual(window.entries.map(item => item.id), Array.from({ length: window.entries.length }, (_, index) => `item_${window.omitted + index}`));
    const document = records.find(record => record.typeName === 'document');
    const present = document?.meta.present as { transcript: unknown[]; transcriptOmitted: number };
    assert.ok(Buffer.byteLength(JSON.stringify(present.transcript), 'utf8') <= MAX_TRANSCRIPT_BYTES);
    assert.equal(present.transcriptOmitted, window.omitted);
    const revision = store.getRoom(roomId).revision;
    append(roomId, 'listener', 'bounded_session', { id: 'item_34', role: 'user', text });
    assert.equal(store.getRoom(roomId).revision, revision);
    store.close(); store = new RoomStore({ directory });
    assert.deepEqual(readTranscriptWindow(store.getCanvasRecords(roomId)), window);
    assert.equal(store.getRoom(roomId).objects[0].data.text, 'Keep the canvas.');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
