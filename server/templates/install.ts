import { isDeepStrictEqual } from 'node:util';
import { initialSnapshot } from '../tldraw-persistence';
import type { TLSocketRoom } from '@tldraw/sync-core';
import type { TLRecord } from '@tldraw/tlschema';

/** Host reserves a fresh room ID before calling this. Never installs into a used room. */
export async function installTemplateRecords(room: TLSocketRoom<TLRecord>, records: TLRecord[]): Promise<void> {
  await room.updateStore(store => {
    const existing = store.getAll();
    const initial = initialSnapshot().documents.map(d => d.state);
    if (existing.length !== initial.length || existing.some(r => !initial.some(i => isDeepStrictEqual(i, r)))) throw new Error('Destination room is not empty.');
    for (const record of existing) if (record.typeName === 'page') store.delete(record.id);
    for (const record of records) {
      if (!['page', 'shape', 'binding'].includes(record.typeName)) throw new Error('Invalid template record.');
      store.put(record);
    }
  });
}
