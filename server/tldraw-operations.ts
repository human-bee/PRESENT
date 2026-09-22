import type { TLSyncStorageTransaction } from '@tldraw/sync-core';
import type { TLRecord, TLShape, TLShapePartial } from '@tldraw/tlschema';
import { getIndexAbove, type JsonObject } from '@tldraw/utils';
import type { Operation } from '../shared/room';
import { DOCUMENT_ID, objectToRecords, patchNativeShape, shapeIdForObject } from '../shared/tldraw-adapter';
import { RoomError } from './tldraw-errors';

export type NativeMutation = { creates?: TLRecord[]; updates?: TLShapePartial[]; deletes?: string[]; documentMeta?: JsonObject };
type Transaction = TLSyncStorageTransaction<TLRecord>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function requireCanvasPage(records: Iterable<TLRecord>, pageId?: string) {
  const page = [...records].find(item => item.typeName === 'page' && (pageId === undefined || item.id === pageId));
  if (page?.typeName !== 'page') throw new RoomError('That canvas page no longer exists.', 404);
  return page.id;
}

export function deleteShapeTree(transaction: Transaction, id: string) {
  const deleted = new Set([id]);
  const records = [...transaction.values()];
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of records) if (item.typeName === 'shape' && deleted.has(item.parentId) && !deleted.has(item.id)) { deleted.add(item.id); expanded = true; }
  }
  for (const item of records) if (item.typeName === 'binding' && (deleted.has(item.fromId) || deleted.has(item.toId))) deleted.add(item.id);
  for (const key of deleted) transaction.delete(key);
}

export function applyDtoOperation(transaction: Transaction, operation: Operation, actor: string, now: number) {
  if (operation.type === 'put') {
    const id = shapeIdForObject(operation.object.id);
    if (transaction.get(id)) throw new RoomError('An object with this ID already exists.', 409);
    const records = [...transaction.values()];
    const parentId = requireCanvasPage(records, operation.pageId);
    const indices = records.filter((item): item is TLShape => item.typeName === 'shape' && item.parentId === parentId).map(shape => shape.index).sort();
    const object = { ...operation.object, createdBy: actor, createdAt: now };
    for (const item of objectToRecords(object, { parentId: parentId as TLShape['parentId'], index: getIndexAbove(indices.at(-1)) })) transaction.set(item.id, item);
    return;
  }
  if (operation.type === 'rename') {
    const document = transaction.get(DOCUMENT_ID);
    if (document?.typeName !== 'document') throw new RoomError('Missing native document.', 500);
    transaction.set(document.id, { ...document, name: operation.title });
    return;
  }
  const id = shapeIdForObject(operation.id), shape = transaction.get(id);
  if (shape?.typeName !== 'shape') throw new RoomError('That object no longer exists.', 404);
  if (operation.type === 'remove') { deleteShapeTree(transaction, id); return; }
  if (operation.type === 'increment') {
    if (shape.type !== 'present-widget' || shape.props.kind !== 'widget') throw new RoomError('Only widget state supports increments.');
    const state = record(shape.props.data.state);
    const current = Object.hasOwn(state, operation.key) ? state[operation.key] : 0;
    if (typeof current !== 'number' || !Number.isFinite(current + operation.by)) throw new RoomError('An increment requires finite numeric widget state.');
    transaction.set(id, { ...shape, props: { ...shape.props, data: { ...shape.props.data, state: { ...state, [operation.key]: current + operation.by } } } } as TLShape);
    return;
  }
  if (!Object.keys(operation.patch).length) throw new RoomError('An object patch cannot be empty.');
  try { transaction.set(id, patchNativeShape(shape, operation.patch)); }
  catch (error) { throw error instanceof RoomError ? error : new RoomError(error instanceof Error ? error.message : 'Invalid shape patch.'); }
}

export function applyNativeMutation(transaction: Transaction, mutation: NativeMutation) {
  if (mutation.documentMeta) {
    const document = transaction.get(DOCUMENT_ID);
    if (document?.typeName !== 'document') throw new RoomError('Missing native document.', 500);
    transaction.set(document.id, { ...document, meta: { ...document.meta, ...mutation.documentMeta } });
  }
  for (const item of mutation.creates ?? []) {
    if (!['shape', 'asset', 'binding'].includes(item.typeName)) throw new RoomError('Only canvas records can be created by canvas tools.');
    if (transaction.get(item.id)) throw new RoomError('A native record with this ID already exists.', 409);
    transaction.set(item.id, item);
  }
  for (const update of mutation.updates ?? []) {
    const previous = transaction.get(update.id);
    if (previous?.typeName !== 'shape') throw new RoomError('That native shape no longer exists.', 404);
    if (update.type !== undefined && update.type !== previous.type) throw new RoomError('A native shape update cannot change its type.');
    transaction.set(update.id, { ...previous, ...update, id: previous.id, type: previous.type, typeName: 'shape', props: { ...previous.props, ...update.props }, meta: { ...previous.meta, ...update.meta } } as TLShape);
  }
  for (const id of mutation.deletes ?? []) {
    const shape = transaction.get(shapeIdForObject(id));
    if (shape?.typeName !== 'shape') throw new RoomError('That native shape no longer exists.', 404);
    deleteShapeTree(transaction, shape.id);
  }
}
