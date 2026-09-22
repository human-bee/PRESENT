import { b64Vecs, createShapeId, toRichText, type TLAsset, type TLParentId, type TLRecord, type TLShape, type TLShapeId } from '@tldraw/tlschema';
import { getIndexAbove, type IndexKey, type JsonObject } from '@tldraw/utils';
import type { ObjectPatch, RoomEvent, RoomObject, RoomState } from './room';
import { presentSchema } from './tldraw-schema';

export const DEFAULT_PAGE_ID = 'page:page' as TLParentId;
export const DOCUMENT_ID = 'document:document';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const shapeIdForObject = (id: string): TLShapeId => id.startsWith('shape:') ? id as TLShapeId : createShapeId(id);
const textContent = (value: unknown): string => {
  const node = record(value);
  if (typeof node.text === 'string') return node.text;
  return Array.isArray(node.content) ? node.content.map(textContent).join(node.type === 'doc' ? '\n' : '') : '';
};
const colors: Record<string, string> = { mint: 'light-green', violet: 'violet', blue: 'light-blue', pink: 'light-red' };
function nativeColor(value: unknown): string {
  const candidate = typeof value === 'string' ? colors[value] ?? value : 'light-green';
  return ['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white'].includes(candidate) ? candidate : 'light-green';
}
function provenance(object: RoomObject): JsonObject {
  return { title: object.title, pinned: object.pinned, createdBy: object.createdBy, createdAt: object.createdAt, expiresAt: object.expiresAt };
}
function pointsFromData(value: unknown) {
  return Array.isArray(value) ? value.flatMap(point => {
    const p: Record<string, unknown> = Array.isArray(point) ? { x: point[0], y: point[1] } : record(point);
    return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y) ? [{ x: p.x, y: p.y, z: number(p.z, .5) }] : [];
  }) : [];
}

/** DTOs are adapters for agents and imports. Native records remain the only document. */
export function objectToShape(object: RoomObject, options: { index?: IndexKey; parentId?: TLParentId } = {}): TLShape {
  if (object.kind === 'image') return imageToRecords({ ...object, kind: 'image' }, options)[1] as TLShape;
  const base = { id: shapeIdForObject(object.id), typeName: 'shape' as const, x: object.x, y: object.y, rotation: 0, index: options.index ?? getIndexAbove(), parentId: options.parentId ?? DEFAULT_PAGE_ID, isLocked: false, opacity: 1, meta: { present: provenance(object) } };
  let shape: unknown;
  if (object.kind === 'note') {
    const { text: _text, color: _color, ...extraData } = object.data;
    shape = { ...base, type: 'note', meta: { present: { ...provenance(object), extraData } }, props: { color: nativeColor(object.data.color), labelColor: 'black', size: 'm', font: 'sans', fontSizeAdjustment: null, align: 'start', verticalAlign: 'start', growY: Math.max(0, object.h / (object.w / 200) - 200), url: '', richText: toRichText(typeof object.data.text === 'string' ? object.data.text : ''), scale: object.w / 200, textLastEditedBy: null } };
  } else if (object.kind === 'ink') {
    shape = { ...base, type: 'draw', props: { color: nativeColor(object.data.color), fill: 'none', dash: 'draw', size: 'm', segments: [{ type: 'free', path: b64Vecs.encodePoints(pointsFromData(object.data.points)) }], isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1 } };
  } else {
    shape = { ...base, type: 'present-widget', meta: {}, props: { w: object.w, h: object.h, kind: object.kind, title: object.title, data: object.data, pinned: object.pinned, createdBy: object.createdBy, createdAt: object.createdAt, expiresAt: object.expiresAt } };
  }
  return presentSchema.types.shape.validate(shape as TLShape) as TLShape;
}

export function objectToRecords(object: RoomObject, options: { index?: IndexKey; parentId?: TLParentId } = {}): TLRecord[] {
  return object.kind === 'image' ? imageToRecords({ ...object, kind: 'image' }, options) : [objectToShape(object, options)];
}

/** An image has one reusable asset record and a native image shape. */
export function imageToRecords(object: Omit<RoomObject, 'kind'> & { kind: 'image' }, options: { index?: IndexKey; parentId?: TLParentId } = {}): TLRecord[] {
  const assetId = `asset:${object.id}` as TLAsset['id'];
  const { src, mimeType, imageWidth, imageHeight, ...extraData } = object.data;
  const asset = presentSchema.types.asset.validate({ id: assetId, typeName: 'asset', type: 'image', props: { w: Math.max(1, number(imageWidth, object.w)), h: Math.max(1, number(imageHeight, object.h)), name: object.title, src, mimeType: typeof mimeType === 'string' ? mimeType : null, isAnimated: false }, meta: {} } as TLAsset);
  const shape = presentSchema.types.shape.validate({ id: shapeIdForObject(object.id), typeName: 'shape', type: 'image', x: object.x, y: object.y, rotation: 0, index: options.index ?? getIndexAbove(), parentId: options.parentId ?? DEFAULT_PAGE_ID, isLocked: false, opacity: 1, meta: { present: { ...provenance(object), extraData } }, props: { w: object.w, h: object.h, playing: true, url: '', assetId, crop: null, flipX: false, flipY: false, altText: object.title } } as TLShape);
  return [asset, shape];
}

export function shapeToObject(shape: TLShape, records: TLRecord[] = []): RoomObject {
  const props = record(shape.props), meta = record(shape.meta.present);
  const base = { id: shape.id.slice(6), x: shape.x, y: shape.y, w: number(props.w, 200), h: number(props.h, 200), title: typeof meta.title === 'string' ? meta.title : shape.type, pinned: meta.pinned === true, createdBy: typeof meta.createdBy === 'string' ? meta.createdBy : '', createdAt: number(meta.createdAt, 0), expiresAt: typeof meta.expiresAt === 'number' ? meta.expiresAt : null };
  if (shape.type === 'present-widget') return { ...base, ...shape.props, id: base.id, x: base.x, y: base.y };
  if (shape.type === 'note' || shape.type === 'text') {
    const scale = number(props.scale, 1);
    return { ...base, kind: 'note', w: shape.type === 'note' ? 200 * scale : base.w * scale, h: shape.type === 'note' ? (200 + number(props.growY, 0)) * scale : base.h, data: { ...record(meta.extraData), text: textContent(props.richText), color: props.color } };
  }
  if (shape.type === 'draw') {
    const points = shape.props.segments.flatMap(segment => b64Vecs.decodePoints(segment.path, segment.dim));
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    return { ...base, kind: 'ink', w: Math.max(80, (Math.max(0, ...xs) - Math.min(0, ...xs)) * shape.props.scaleX), h: Math.max(60, (Math.max(0, ...ys) - Math.min(0, ...ys)) * shape.props.scaleY), data: { points, color: props.color } };
  }
  if (shape.type === 'image') {
    const asset = records.find((item): item is Extract<TLAsset, { type: 'image' }> => item.typeName === 'asset' && item.type === 'image' && item.id === shape.props.assetId);
    return { ...base, kind: 'image', data: { ...record(meta.extraData), assetId: shape.props.assetId, ...(asset ? { src: asset.props.src, mimeType: asset.props.mimeType, imageWidth: asset.props.w, imageHeight: asset.props.h } : {}) } };
  }
  return { ...base, kind: 'widget', data: { nativeType: shape.type, nativeProps: shape.props, parentId: shape.parentId, rotation: shape.rotation } };
}

export function patchNativeShape(shape: TLShape, patch: ObjectPatch): TLShape {
  const previous = shapeToObject(shape);
  const data = patch.data ? { ...previous.data, ...patch.data } : previous.data;
  if (shape.type === 'present-widget' && patch.data && Object.hasOwn(patch.data, 'state')) {
    if (!patch.data.state || typeof patch.data.state !== 'object' || Array.isArray(patch.data.state)) throw new Error('Widget state must be a JSON object.');
    data.state = { ...record(previous.data.state), ...patch.data.state };
  }
  if (shape.type === 'present-widget') {
    const updated = objectToShape({ ...previous, ...patch, data }, { index: shape.index, parentId: shape.parentId });
    return { ...updated, rotation: shape.rotation, opacity: shape.opacity, isLocked: shape.isLocked, meta: { ...shape.meta, ...updated.meta } };
  }
  const props = { ...shape.props } as Record<string, unknown>;
  const present = { ...record(shape.meta.present), ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}), ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}) };
  if (shape.type === 'note' || shape.type === 'text') {
    if (patch.data && Object.hasOwn(patch.data, 'text')) {
      if (typeof patch.data.text !== 'string') throw new Error('Native note text must be a string.');
      props.richText = toRichText(patch.data.text);
    }
    if (patch.data?.color !== undefined) props.color = nativeColor(patch.data.color);
    const { text: _text, color: _color, ...extraData } = data;
    Object.assign(present, { extraData });
    if (shape.type === 'note') {
      const scale = patch.w !== undefined ? patch.w / 200 : shape.props.scale;
      props.scale = scale;
      if (patch.h !== undefined) props.growY = Math.max(0, patch.h / scale - 200);
    } else if (patch.w !== undefined) props.w = patch.w / shape.props.scale;
  } else if (shape.type === 'draw') {
    if (patch.data?.points !== undefined) props.segments = [{ type: 'free', path: b64Vecs.encodePoints(pointsFromData(patch.data.points)) }];
    if (patch.data?.color !== undefined) props.color = nativeColor(patch.data.color);
    if (patch.w !== undefined) props.scaleX = shape.props.scaleX * patch.w / previous.w;
    if (patch.h !== undefined) props.scaleY = shape.props.scaleY * patch.h / previous.h;
  } else if (patch.data) throw new Error('Edit this native shape through the tldraw editor.');
  // Native objects outside the DTO creation vocabulary keep their exact type/props.
  if (patch.w !== undefined && 'w' in props && shape.type !== 'text') props.w = patch.w;
  if (patch.h !== undefined && 'h' in props) props.h = patch.h;
  return presentSchema.types.shape.validate({ ...shape, x: patch.x ?? shape.x, y: patch.y ?? shape.y, props, meta: { ...shape.meta, present } } as TLShape) as TLShape;
}

export function recordsToRoom(id: string, records: TLRecord[], revision = 0): RoomState {
  const document = records.find(record => record.typeName === 'document');
  const present = record(document?.meta.present);
  const events = Array.isArray(present.events) ? present.events.filter(event => {
    const value = record(event); return typeof value.id === 'string' && typeof value.actor === 'string' && typeof value.text === 'string' && typeof value.at === 'number';
  }) as RoomEvent[] : [];
  return { id, title: document?.typeName === 'document' ? document.name || 'Untitled room' : 'Untitled room', revision, objects: records.filter((record): record is TLShape => record.typeName === 'shape').map(shape => shapeToObject(shape, records)), events };
}
