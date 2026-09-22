import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentRecordType, PageRecordType, TLDOCUMENT_ID, type TLPageId, type TLRecord } from '@tldraw/tlschema';
import type { RoomSnapshot } from '@tldraw/sync-core';
import { getIndexAbove, type IndexKey, type JsonObject } from '@tldraw/utils';
import { objectSchema } from '../shared/room';
import { DEFAULT_PAGE_ID, objectToRecords } from '../shared/tldraw-adapter';
import { presentSchema } from '../shared/tldraw-schema';
import { RoomError } from './tldraw-errors';
import { MAX_ROOM_BYTES, validateRecords } from './tldraw-storage';

export function initialSnapshot(): RoomSnapshot {
  return { clock: 0, documentClock: 0, schema: presentSchema.serialize(), documents: [
    { state: DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Untitled room', meta: { present: { events: [], requests: [] } } }), lastChangedClock: 0 },
    { state: PageRecordType.create({ id: DEFAULT_PAGE_ID as TLPageId, name: 'Page 1', index: 'a1' as IndexKey }), lastChangedClock: 0 },
  ] };
}
function readBounded(file: string): unknown {
  const text = readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > MAX_ROOM_BYTES + 500_000) throw new Error('Saved snapshot exceeds the room limit.');
  return JSON.parse(text);
}
export function readRoomSnapshot(directory: string, legacyDirectory: string, id: string): RoomSnapshot {
  const file = join(directory, `${id}.json`), legacy = join(legacyDirectory, `${id}.json`);
  try {
    if (existsSync(file)) {
      const snapshot = readBounded(file) as RoomSnapshot;
      if (!Array.isArray(snapshot.documents) || !Number.isSafeInteger(snapshot.documentClock ?? snapshot.clock)) throw new Error('Invalid snapshot.');
      return snapshot;
    }
    if (!existsSync(legacy)) return initialSnapshot();
    // One-way import only. The original JSON is never opened for writing.
    const saved = readBounded(legacy) as { state: { id: string; title: string; revision: number; objects: unknown[]; events?: unknown[] }; requests?: unknown[] };
    if (saved.state.id !== id || !Array.isArray(saved.state.objects) || typeof saved.state.title !== 'string') throw new Error('Invalid original room.');
    const snapshot = initialSnapshot();
    const document = snapshot.documents[0].state as ReturnType<typeof DocumentRecordType.create>;
    document.name = saved.state.title;
    document.meta = { present: { events: (saved.state.events ?? []).slice(-80), requests: (saved.requests ?? []).slice(-500), importedFrom: 'room-object-json' } as JsonObject };
    let index = getIndexAbove();
    const shapes = saved.state.objects.flatMap(input => {
      const object = objectSchema.parse(input);
      const records = objectToRecords(object, { index });
      index = getIndexAbove(index);
      return records;
    });
    const clock = Number.isSafeInteger(saved.state.revision) && saved.state.revision >= 0 ? saved.state.revision : 0;
    snapshot.documents.push(...shapes.map(state => ({ state, lastChangedClock: clock })));
    snapshot.documentClock = snapshot.clock = clock;
    validateRecords(snapshot.documents.map(document => document.state as TLRecord));
    return snapshot;
  } catch { throw new RoomError('This room could not be restored. Its saved files have been preserved.', 500); }
}
