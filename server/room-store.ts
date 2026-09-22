import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TLSocketRoom, type RoomSnapshot, type TLSyncStorageTransaction } from '@tldraw/sync-core';
import type { TLRecord } from '@tldraw/tlschema';
import type { JsonObject } from '@tldraw/utils';
import { operationSchema, type RoomState } from '../shared/room';
import { DOCUMENT_ID, recordsToRoom, shapeToObject } from '../shared/tldraw-adapter';
import { presentSchema } from '../shared/tldraw-schema';
import { RoomError, validRoomId } from './tldraw-errors';
import { applyDtoOperation, applyNativeMutation, deleteShapeTree, type NativeMutation } from './tldraw-operations';
import { readRoomSnapshot } from './tldraw-persistence';
import { BoundedSyncStorage, finiteJson, validateRecords } from './tldraw-storage';
export { RoomError, validRoomId } from './tldraw-errors';
export type { NativeMutation } from './tldraw-operations';

type Listener = (room: RoomState, requestId?: string) => void;
type Entry = { native: TLSocketRoom<TLRecord>; storage: BoundedSyncStorage; listeners: Set<Listener>; dirty: boolean; publishedClock: number; savedClock: number };
type Options = { directory?: string; legacyDirectory?: string; now?: () => number; debounceMs?: number; maxRooms?: number };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const copy = <T>(value: T): T => structuredClone(value);

/** Each room owns one TLSocketRoom. RoomState is a read-only projection of its records. */
export class RoomStore {
  private rooms = new Map<string, Entry>();
  private timer?: ReturnType<typeof setTimeout>;
  private directory: string;
  private legacyDirectory: string;
  private now: () => number;
  private debounceMs: number;
  private maxRooms: number;
  constructor(options: Options = {}) {
    this.directory = options.directory ?? join(process.cwd(), '.data', 'tldraw');
    this.legacyDirectory = options.legacyDirectory ?? (options.directory ? join(options.directory, 'legacy') : join(process.cwd(), '.data', 'rooms'));
    this.now = options.now ?? Date.now;
    this.debounceMs = options.debounceMs ?? 150;
    this.maxRooms = options.maxRooms ?? 1000;
  }
  private load(id: string): Entry {
    if (!validRoomId(id)) throw new RoomError('Invalid room link.');
    const current = this.rooms.get(id);
    if (current) return current;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const files = readdirSync(this.directory).filter(name => /^[a-f0-9]{24,64}\.json$/.test(name));
    const known = new Set([...files.map(name => name.slice(0, -5)), ...this.rooms.keys()]);
    if (this.rooms.size >= this.maxRooms || (!known.has(id) && known.size >= this.maxRooms)) throw new RoomError('This server has reached its room limit.', 503);
    const snapshot = readRoomSnapshot(this.directory, this.legacyDirectory, id);
    const storage = new BoundedSyncStorage({ snapshot });
    let native: TLSocketRoom<TLRecord>;
    try {
      native = new TLSocketRoom<TLRecord>({ storage, schema: presentSchema, clientTimeout: 30_000 });
      const records = storage.getSnapshot().documents.map(document => document.state as TLRecord);
      validateRecords(records);
      for (const record of records) (presentSchema.types[record.typeName] as { validate(value: unknown): TLRecord }).validate(record);
    } catch { throw new RoomError('This native room could not be restored. Its saved files have been preserved.', 500); }
    const existed = existsSync(join(this.directory, `${id}.json`));
    const entry: Entry = { native, storage, listeners: new Set(), dirty: !existed, publishedClock: storage.getClock(), savedClock: existed ? snapshot.documentClock ?? snapshot.clock ?? -1 : -1 };
    storage.onChange(() => this.changed(id, entry));
    this.rooms.set(id, entry);
    this.expire(id, entry);
    if (entry.dirty) this.scheduleSave();
    return entry;
  }
  getTldrawRoom(id: string) { return this.load(id).native; }
  getRoomSnapshot(id: string): RoomSnapshot { return copy(this.load(id).storage.getSnapshot()); }
  getCanvasRecords(id: string): TLRecord[] { return this.getRoomSnapshot(id).documents.map(document => document.state as TLRecord); }
  getRoom(id: string): RoomState {
    const entry = this.load(id);
    this.expire(id, entry);
    return recordsToRoom(id, this.getCanvasRecords(id), entry.native.getCurrentDocumentClock());
  }
  subscribeRoom(id: string, listener: Listener) {
    const entry = this.load(id); entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }
  private transact(id: string, input: unknown, actor: string, text: string, callback: (transaction: TLSyncStorageTransaction<TLRecord>) => void, requestId?: string): RoomState {
    if (!actor || actor.length > 100 || (requestId !== undefined && !/^[\w:.-]{1,100}$/.test(requestId))) throw new RoomError('Invalid operation identity.');
    const encoded = finiteJson(input);
    if (Buffer.byteLength(encoded) > 256_000) throw new RoomError('This operation is too large.', 413);
    const digest = createHash('sha256').update(encoded).digest('hex'), entry = this.load(id);
    this.expire(id, entry);
    entry.storage.transaction(transaction => {
      const original = transaction.get(DOCUMENT_ID);
      if (original?.typeName !== 'document') throw new RoomError('Missing native document.', 500);
      const present = object(original.meta.present);
      const requests = new Map<string, string>(Array.isArray(present.requests) ? present.requests.filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) : []);
      if (requestId && requests.has(requestId)) {
        if (requests.get(requestId) !== digest) throw new RoomError('Request ID already belongs to a different operation.', 409);
        return;
      }
      callback(transaction);
      const document = transaction.get(DOCUMENT_ID);
      if (document?.typeName !== 'document') throw new RoomError('Missing native document.', 500);
      if (requestId) requests.set(requestId, digest);
      const events = [...(Array.isArray(present.events) ? present.events : []), { id: randomUUID(), actor, at: this.now(), text }].slice(-80);
      transaction.set(document.id, { ...document, meta: { ...document.meta, present: { ...object(document.meta.present), events, requests: [...requests].slice(-500) } as JsonObject } });
    }, { id: requestId });
    this.changed(id, entry, requestId);
    return this.getRoom(id);
  }
  applyOperation(id: string, input: unknown, actor: string, options: { requestId?: string } = {}): RoomState {
    const parsed = operationSchema.safeParse(input);
    if (!parsed.success) throw new RoomError('Invalid room operation.');
    const operation = parsed.data;
    const descriptions = { put: 'Added an object', patch: 'Updated an object', increment: 'Updated widget state', remove: 'Removed an object', rename: 'Renamed the room' };
    return this.transact(id, operation, actor, descriptions[operation.type], transaction => applyDtoOperation(transaction, operation, actor, this.now()), options.requestId);
  }
  mutateCanvas(id: string, mutation: NativeMutation, actor: string, options: { requestId?: string } = {}): RoomState {
    return this.transact(id, mutation, actor, 'Updated the canvas', transaction => applyNativeMutation(transaction, mutation), options.requestId);
  }
  transactCanvas(id: string, input: unknown, actor: string, build: (records: TLRecord[]) => NativeMutation, options: { requestId?: string } = {}): RoomState {
    return this.transact(id, input, actor, 'Updated the canvas', transaction => applyNativeMutation(transaction, build(copy([...transaction.values()]))), options.requestId);
  }
  private changed(id: string, entry: Entry, requestId?: string) {
    const clock = entry.storage.getClock();
    if (clock === entry.publishedClock) return;
    entry.publishedClock = clock; entry.dirty = true; this.scheduleSave();
    if (!entry.listeners.size) return;
    const state = recordsToRoom(id, entry.storage.getSnapshot().documents.map(document => document.state as TLRecord), clock);
    for (const listener of entry.listeners) try { listener(copy(state), requestId); } catch { /* A closed subscriber cannot roll back accepted work. */ }
  }
  private expire(id: string, entry: Entry) {
    entry.storage.transaction(transaction => {
      for (const record of transaction.values()) {
        if (record.typeName !== 'shape') continue;
        const shape = shapeToObject(record);
        if (!shape.pinned && shape.expiresAt !== null && shape.expiresAt <= this.now()) deleteShapeTree(transaction, record.id);
      }
    });
    this.changed(id, entry);
  }
  sweepExpired() { for (const [id, entry] of this.rooms) this.expire(id, entry); }
  private scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try { this.flush(); } catch { console.error('Native room save failed; pending changes will be retried.'); this.scheduleSave(); }
    }, this.debounceMs);
    this.timer.unref();
  }
  flush() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const [id, entry] of this.rooms) {
      if (!entry.dirty && entry.savedClock === entry.storage.getClock()) continue;
      const file = join(this.directory, `${id}.json`), temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(entry.storage.getSnapshot()), { mode: 0o600 });
      renameSync(temporary, file); entry.dirty = false; entry.savedClock = entry.storage.getClock();
    }
  }
  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.flush();
    for (const entry of this.rooms.values()) entry.native.close();
    this.rooms.clear();
  }
}

const store = new RoomStore();
export const getRoom = (id: string) => store.getRoom(id);
export const getTldrawRoom = (id: string) => store.getTldrawRoom(id);
export const getRoomSnapshot = (id: string) => store.getRoomSnapshot(id);
export const getCanvasRecords = (id: string) => store.getCanvasRecords(id);
export const applyOperation = (id: string, operation: unknown, actor: string, options?: { requestId?: string }) => store.applyOperation(id, operation, actor, options);
export const mutateCanvas = (id: string, mutation: NativeMutation, actor: string, options?: { requestId?: string }) => store.mutateCanvas(id, mutation, actor, options);
export const transactCanvas = (id: string, input: unknown, actor: string, build: (records: TLRecord[]) => NativeMutation, options?: { requestId?: string }) => store.transactCanvas(id, input, actor, build, options);
export const subscribeRoom = (id: string, listener: Listener) => store.subscribeRoom(id, listener);
export const sweepExpired = () => store.sweepExpired();
export const closeRoomStore = () => store.close();
