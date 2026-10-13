import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RoomStore } from '../server/room-store';

// Produced with the original native RoomStore and installed tldraw 5.4.0 family.
const fixture = new URL('./fixtures/dependencies/native-tldraw-5.4.json', import.meta.url);
const roomId = 'c'.repeat(32);
test('tldraw 5.5 restores, mutates and reloads a real 5.4 native snapshot without resetting its records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-schema-upgrade-'));
  const source = readFileSync(fixture, 'utf8');
  let store: RoomStore | undefined;
  try {
    copyFileSync(fixture, join(directory, `${roomId}.json`));
    store = new RoomStore({ directory, legacyDirectory: join(directory, 'legacy') });
    const before = store.getRoom(roomId);
    assert.equal(before.objects.length, 2);
    const note = before.objects.find(object => object.kind === 'note');
    const timer = before.objects.find(object => object.kind === 'timer');
    assert.ok(note); assert.ok(timer);
    assert.equal(note.data.text, 'Saved under tldraw5.4.0');
    store.applyOperation(roomId, { type: 'patch', id: note.id, patch: { data: { text: 'Continued under tldraw5.5.2' } } }, 'replay-human');
    store.close(); store = new RoomStore({ directory, legacyDirectory: join(directory, 'legacy') });
    const after = store.getRoom(roomId);
    assert.equal(after.objects.length, 2);
    assert.equal(after.objects.find(object => object.id === note.id)?.data.text, 'Continued under tldraw5.5.2');
    assert.deepEqual(after.objects.find(object => object.id === timer.id), timer);
    assert.ok(after.revision > before.revision);
    assert.equal(readFileSync(fixture, 'utf8'), source);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
