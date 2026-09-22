import { InMemorySyncStorage, type TLSyncStorageTransactionCallback, type TLSyncStorageTransactionOptions } from '@tldraw/sync-core';
import type { TLRecord } from '@tldraw/tlschema';
import { presentSchema } from '../shared/tldraw-schema';
import { RoomError } from './tldraw-errors';

// Native diagrams contain many small shapes, including transient generation previews.
export const MAX_SHAPES = 2_000;
export const MAX_RECORDS = 6_000;
export const MAX_ROOM_BYTES = 10_000_000;
export function finiteJson(value: unknown): string {
  try {
    return JSON.stringify(value, (key, child: unknown) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint' || (typeof child === 'number' && !Number.isFinite(child))) throw new Error();
      return child;
    });
  } catch { throw new RoomError('Object data must be finite JSON values.'); }
}
export function validateRecords(records: Iterable<TLRecord>) {
  let shapes = 0, bytes = 0, recordsCount = 0;
  for (const item of records) {
    const encoded = finiteJson(item), length = Buffer.byteLength(encoded);
    if (item.typeName === 'shape') {
      if (++shapes > MAX_SHAPES) throw new RoomError('This room has reached its object limit.', 409);
      if (length > 40_000) throw new RoomError('This object is too large.', 413);
    }
    if (++recordsCount > MAX_RECORDS) throw new RoomError('This room has reached its record limit.', 409);
    bytes += length;
    if (bytes > MAX_ROOM_BYTES) throw new RoomError('This room is full.', 413);
  }
}

/** Bounds apply at the native transaction boundary to browser and agent writes alike. */
export class BoundedSyncStorage extends InMemorySyncStorage<TLRecord> {
  override transaction<T>(callback: TLSyncStorageTransactionCallback<TLRecord, T>, options?: TLSyncStorageTransactionOptions) {
    return super.transaction<T>((transaction => {
      let wrote = false;
      const guarded = new Proxy(transaction, {
        get(target, key) {
          if (key === 'set') return (id: string, value: TLRecord) => {
            if (id !== value.id) throw new RoomError('Native record identity does not match its storage key.');
            finiteJson(value);
            const type = presentSchema.types[value.typeName] as { validate(record: unknown): TLRecord } | undefined;
            if (!type) throw new RoomError('Unknown native record type.');
            type.validate(value);
            wrote = true;
            target.set(id, value);
          };
          if (key === 'delete') return (id: string) => { wrote = true; target.delete(id); };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const result = callback(guarded);
      if (wrote) validateRecords(transaction.values());
      return result;
    }) as TLSyncStorageTransactionCallback<TLRecord, T>, options);
  }
}
