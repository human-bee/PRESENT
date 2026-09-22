import { createHash, randomUUID } from 'node:crypto';
import { b64Vecs, toRichText, type TLBinding, type TLRecord, type TLShape, type TLShapeId, type TLShapePartial } from '@tldraw/tlschema';
import { getIndexAbove, type IndexKey } from '@tldraw/utils';
import { canvasToolSchemas, type CanvasBatch, type CanvasCommand } from '../../shared/canvas-commands';
import { presentSchema } from '../../shared/tldraw-schema';
import { getCanvasRecords, transactCanvas } from '../room-store';
import { AgentError } from './contract';

const fail = (message: string): never => { throw new AgentError(message, 400); };
const commandId = (requestId: string, ordinal: number) => `shape:voice_${createHash('sha256').update(`${requestId}:${ordinal}`).digest('hex').slice(0, 28)}` as TLShapeId;
const textFromRichText = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const node = value as { text?: string; content?: unknown[]; type?: string };
  return typeof node.text === 'string' ? node.text : Array.isArray(node.content) ? node.content.map(textFromRichText).join(node.type === 'doc' ? '\n' : '') : '';
};
function onPage(shape: TLShape, pageId: string, records: Map<string, TLRecord>): boolean {
  let parent = shape.parentId as string;
  const visited = new Set<string>();
  while (parent.startsWith('shape:') && !visited.has(parent)) {
    visited.add(parent);
    const record = records.get(parent); if (record?.typeName !== 'shape') return false;
    parent = record.parentId;
  }
  return parent === pageId;
}
const nativeProps = (props: Record<string, unknown>) => {
  const { text, points, ...rest } = props;
  return { ...rest, ...(typeof text === 'string' ? { richText: toRichText(text) } : {}), ...(Array.isArray(points) ? { segments: [{ type: 'free', path: b64Vecs.encodePoints(points as { x: number; y: number }[]) }] } : {}) };
};
function createProps(command: Extract<CanvasCommand, { x: number }>): { type: string; props: Record<string, unknown> } {
  const style = { color: command.color, size: 'm' };
  if (command.type === 'create_geo') return { type: 'geo', props: { ...style, w: command.w, h: command.h, geo: command.geo, fill: command.fill, dash: 'draw', growY: 0, url: '', scale: 1, flipX: false, flipY: false, labelColor: 'black', font: 'draw', align: 'middle', verticalAlign: 'middle', richText: toRichText(command.text) } };
  if (command.type === 'create_text') return { type: 'text', props: { ...style, w: command.w, font: 'draw', textAlign: 'start', autoSize: false, scale: 1, richText: toRichText(command.text) } };
  if (command.type === 'create_note') return { type: 'note', props: { ...style, labelColor: 'black', font: 'draw', fontSizeAdjustment: null, align: 'start', verticalAlign: 'start', growY: 0, url: '', richText: toRichText(command.text), scale: 1, textLastEditedBy: null } };
  if (command.type === 'create_arrow') return { type: 'arrow', props: { ...style, kind: 'arc', elbowMidPoint: .5, dash: 'draw', fill: 'none', labelColor: 'black', bend: command.bend, start: command.start, end: command.end, arrowheadStart: 'none', arrowheadEnd: 'arrow', richText: toRichText(command.text), labelPosition: .5, font: 'draw', scale: 1 } };
  return { type: 'draw', props: { ...style, fill: 'none', dash: 'draw', isComplete: true, isClosed: command.isClosed, isPen: false, scale: 1, scaleX: 1, scaleY: 1, ...nativeProps({ points: command.points }) } };
}

/** Produce validated SDK records, then commit once through the room's owning TLSocketRoom. */
export function buildCanvasMutation(batch: CanvasBatch, records: TLRecord[], actor: string, requestId: string = randomUUID()) {
  const current = new Map<string, TLRecord>(records.map(record => [record.id, record]));
  if (current.get(batch.pageId)?.typeName !== 'page') fail('Read canvas again: the requested page does not exist.');
  const creates: TLRecord[] = [], updates: TLShapePartial[] = [], deletes: string[] = [], shapeIds: string[] = [];
  const references = new Map<string, TLShapeId>();
  let index = records.filter((record): record is TLShape => record.typeName === 'shape' && record.parentId === batch.pageId).map(shape => shape.index).sort().at(-1) as IndexKey | undefined;
  const target = (id: string): TLShape => {
    const shape = current.get(id);
    if (shape?.typeName !== 'shape' || !onPage(shape, batch.pageId, current)) return fail('Read canvas again: an exact target shape is missing from this page.');
    if (shape.isLocked) return fail('Unlock the target shape before editing it.');
    return shape;
  };
  batch.commands.forEach((command, ordinal) => {
    if (command.type === 'delete_shape') { target(command.id); deletes.push(command.id); shapeIds.push(command.id); current.delete(command.id); return; }
    if (command.type === 'update_shape') {
      const shape = target(command.id);
      if (shape.type !== command.patch.shapeType) fail('The target shape type changed. Read canvas before editing.');
      if (command.x === undefined && command.y === undefined && command.rotation === undefined && !Object.keys(command.patch.props).length) fail('A canvas update cannot be empty.');
      const updated = presentSchema.types.shape.validate({ ...shape, x: command.x ?? shape.x, y: command.y ?? shape.y, rotation: command.rotation ?? shape.rotation, props: { ...shape.props, ...nativeProps(command.patch.props) } } as TLShape) as TLShape;
      updates.push(updated); current.set(updated.id, updated); shapeIds.push(updated.id); return;
    }
    index = getIndexAbove(index);
    const id = commandId(requestId, ordinal), suffix = id.slice('shape:voice_'.length);
    if (current.has(id)) fail('This canvas shape ID already exists.');
    if (command.ref) {
      if (references.has(command.ref)) fail('Each new canvas reference must be unique.');
      references.set(command.ref, id);
    }
    const shape = presentSchema.types.shape.validate({ id, typeName: 'shape', ...createProps(command), x: command.x, y: command.y, rotation: 0, index, parentId: batch.pageId as TLShape['parentId'], isLocked: false, opacity: 1, meta: { present: { createdBy: actor, requestId } } } as unknown as TLShape) as TLShape;
    creates.push(shape); current.set(id, shape); shapeIds.push(id);
    if (command.type === 'create_arrow') for (const terminal of ['start', 'end'] as const) {
      const binding = terminal === 'start' ? command.startBinding : command.endBinding;
      if (!binding) continue;
      const toId = 'toId' in binding ? binding.toId : references.get(binding.toRef);
      if (!toId || toId === id) throw new AgentError('Bind to an exact existing shape or an earlier new reference.', 400);
      target(toId);
      creates.push(presentSchema.types.binding.validate({ id: `binding:voice_${suffix}_${terminal}`, typeName: 'binding', type: 'arrow', fromId: id, toId, props: { terminal, normalizedAnchor: binding.anchor, isExact: false, isPrecise: true, snap: 'none' }, meta: {} } as TLBinding));
    }
  });
  if (Buffer.byteLength(JSON.stringify({ creates, updates, deletes })) > 65536) fail('Use a smaller canvas command batch.');
  return { mutation: { creates, updates, deletes }, shapeIds };
}

export function readCanvas(roomId: string, pageId?: string, priorityIds: string[] = []) {
  const records = getCanvasRecords(roomId), byId = new Map(records.map(record => [record.id as string, record]));
  const page = pageId ? records.find(record => record.id === pageId && record.typeName === 'page') : records.find(record => record.typeName === 'page');
  if (!page) return fail('That canvas page does not exist.');
  const shapes = records.filter((record): record is TLShape => record.typeName === 'shape' && onPage(record, page.id, byId));
  const priority = new Set(priorityIds.map(id => id.startsWith('shape:') ? id : `shape:${id}`));
  shapes.sort((a, b) => Number(priority.has(b.id)) - Number(priority.has(a.id)));
  return { pageId: page.id, shapeCount: shapes.length, truncated: shapes.length > 80, shapes: shapes.slice(0, 80).map(shape => {
    const props = shape.props as unknown as Record<string, unknown>;
    const { richText, segments: _segments, ...visibleProps } = props;
    return { id: shape.id, type: shape.type, parentId: shape.parentId, x: shape.x, y: shape.y, rotation: shape.rotation, props: shape.type === 'present-widget' ? { w: props.w, h: props.h, kind: props.kind, title: props.title } : visibleProps, ...(richText ? { text: textFromRichText(richText).slice(0, 500) } : {}) };
  }), bindings: records.filter((record): record is TLBinding => record.typeName === 'binding' && shapes.some(shape => shape.id === record.fromId)).slice(0, 80).map(binding => ({ id: binding.id, type: binding.type, fromId: binding.fromId, toId: binding.toId, props: binding.props })),
  capturedAt: Date.now(), source: 'authoritative-tldraw-document', contentTrust: 'untrusted-canvas-data' };
}

export function executeCanvasTool(roomId: string, actor: string, name: 'read_canvas' | 'apply_canvas', args: unknown, requestId: string = randomUUID()) {
  const acceptedAt = Date.now(), started = performance.now();
  if (name === 'read_canvas') {
    const parsed = canvasToolSchemas.read_canvas.safeParse(args);
    if (!parsed.success) return fail(`Invalid canvas read: ${parsed.error.issues[0]?.message ?? 'check the arguments'}`);
    return readCanvas(roomId, parsed.data.pageId);
  }
  const parsed = canvasToolSchemas.apply_canvas.safeParse(args);
  if (!parsed.success) return fail(`Invalid canvas commands: ${parsed.error.issues[0]?.message ?? 'check the arguments'}`);
  const batch = parsed.data;
  const shapeIds = batch.commands.map((command, ordinal) => 'id' in command ? command.id : commandId(requestId, ordinal));
  const room = transactCanvas(roomId, batch, actor, records => buildCanvasMutation(batch, records, actor, requestId).mutation, { requestId });
  return { shapeIds, revision: room.revision, requestId, committed: true, timings: { acceptedAt, committedAt: Date.now(), serverElapsedMs: performance.now() - started }, visibility: 'Committed to shared document; initiating paint and peer convergence are not measured here.' };
}
