import { z } from 'zod';
import { toRichText, type TLRecord, type TLShape, type TLBinding } from '@tldraw/tlschema';
import { getIndexAbove } from '@tldraw/utils';
import { presentSchema } from './tldraw-schema';

export const TEMPLATE_LIMITS = { records: 500, bytes: 240_000, sourceRecords: 10_000 } as const;
export type TemplateNotice = { item: number; reason: 'content-reset' | 'unsupported' | 'missing-parent' | 'missing-endpoint' | 'invalid' };
export type RoomTemplate = { version: 1; name: string; records: TLRecord[]; notices: TemplateNotice[] };
export type TemplateSummary = { id: string; name: string; objects: number; omissions: number };
export type TemplateInstallation = { roomId: string; notices: TemplateNotice[] };
const envelope = z.object({ version: z.literal(1), name: z.string().trim().min(1).max(80), records: z.array(z.unknown()).max(TEMPLATE_LIMITS.records), notices: z.array(z.object({ item: z.number().int().nonnegative(), reason: z.enum(['content-reset', 'unsupported', 'missing-parent', 'missing-endpoint', 'invalid']) }).strict()).max(TEMPLATE_LIMITS.sourceRecords) }).strict();
const propsAllowed: Record<string, string[]> = {
  note: ['color', 'labelColor', 'size', 'font', 'fontSizeAdjustment', 'align', 'verticalAlign', 'growY', 'scale'],
  geo: ['geo', 'w', 'h', 'color', 'labelColor', 'fill', 'dash', 'size', 'font', 'align', 'verticalAlign', 'growY', 'scale'],
  arrow: ['kind', 'color', 'labelColor', 'fill', 'dash', 'size', 'arrowheadStart', 'arrowheadEnd', 'font', 'start', 'end', 'bend', 'labelPosition', 'scale', 'elbowMidPoint'],
};
const pick = (value: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(k => Object.hasOwn(value, k)).map(k => [k, structuredClone(value[k])]));
function bounded(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > TEMPLATE_LIMITS.bytes) throw new Error('Template exceeds 240 KB.');
}
/** No source titles, IDs, metadata, text, assets, runtime state or arbitrary widget data cross this boundary. */
export function exportRoomTemplate(source: readonly TLRecord[], name: string): RoomTemplate {
  if (source.length > TEMPLATE_LIMITS.sourceRecords) throw new Error('Room is too large to export.');
  const notices: TemplateNotice[] = [], records: TLRecord[] = [], ids = new Map<string, string>();
  const notice = (item: number, reason: TemplateNotice['reason']) => notices.push({ item, reason });
  const candidates = source.filter(r => r.typeName === 'page' || r.typeName === 'shape' || r.typeName === 'binding');
  if (candidates.length > TEMPLATE_LIMITS.records) throw new Error('Template exceeds 500 records.');
  if (new Set(candidates.map(r => r.id)).size !== candidates.length) throw new Error('Duplicate record IDs.');
  let index = getIndexAbove();
  for (const [item, record] of candidates.entries()) {
    if (record.typeName !== 'page') continue;
    const id = `page:template_${item}`;
    ids.set(record.id, id);
    records.push(presentSchema.types.page.validate({ id, typeName: 'page', name: `Page ${records.length + 1}`, index, meta: {} } as TLRecord) as TLRecord);
    index = getIndexAbove(index);
  }
  // Only page-level native instruments are supported; nested content is visibly omitted.
  for (const [item, r] of candidates.entries()) {
    if (r.typeName !== 'shape') continue;
    if (!ids.has(r.parentId)) { notice(item, 'missing-parent'); continue; }
    let props: Record<string, unknown>;
    if (r.type === 'present-widget' && r.props.kind === 'timer') {
      const duration = r.props.data.durationMs;
      const durationMs = typeof duration === 'number' && Number.isFinite(duration) ? Math.min(86_400_000, Math.max(1000, duration)) : 300_000;
      props = { w: r.props.w, h: r.props.h, kind: 'timer', title: 'Focus timer', pinned: false, createdBy: '', createdAt: 0, expiresAt: null, data: { durationMs, remainingMs: durationMs, endsAt: null } };
    } else if (propsAllowed[r.type]) {
      props = { ...pick(r.props as unknown as Record<string, unknown>, propsAllowed[r.type]), richText: toRichText('') };
      if (r.type === 'note' || r.type === 'geo') props.url = '';
      if (r.type === 'note') props.textLastEditedBy = null;
    } else { notice(item, 'unsupported'); continue; }
    try {
      const id = `shape:template_${item}`;
      const clean = presentSchema.types.shape.validate({ id, typeName: 'shape', type: r.type, x: r.x, y: r.y, rotation: r.rotation, index: r.index, parentId: ids.get(r.parentId), isLocked: false, opacity: r.opacity, meta: {}, props } as TLShape);
      records.push(clean); ids.set(r.id, id); notice(item, 'content-reset');
    } catch { notice(item, 'invalid'); }
  }
  for (const [item, r] of candidates.entries()) {
    if (r.typeName !== 'binding') continue;
    if (r.type !== 'arrow') { notice(item, 'unsupported'); continue; }
    if (!ids.has(r.fromId) || !ids.has(r.toId)) { notice(item, 'missing-endpoint'); continue; }
    try {
      const binding = presentSchema.types.binding.validate({ id: `binding:template_${item}`, typeName: 'binding', type: 'arrow', fromId: ids.get(r.fromId), toId: ids.get(r.toId), props: pick(r.props as unknown as Record<string, unknown>, ['terminal', 'normalizedAnchor', 'isExact', 'isPrecise', 'snap']), meta: {} } as unknown as TLBinding) as TLBinding;
      if (!records.some(s => s.id === binding.fromId && s.typeName === 'shape' && s.type === 'arrow')) throw new Error();
      records.push(binding);
    } catch { notice(item, 'invalid'); }
  }
  const result: RoomTemplate = { version: 1, name: envelope.shape.name.parse(name), records, notices };
  bounded(result); return result;
}
/** Imported files are untrusted: validate AND sanitize again. */
export function parseRoomTemplate(input: unknown): RoomTemplate {
  bounded(input);
  const value = envelope.parse(input);
  const records = value.records.map(record => {
    const kind = (record as TLRecord)?.typeName;
    if (!['page', 'shape', 'binding'].includes(kind)) throw new Error('Unsupported template record.');
    return (presentSchema.types[kind] as { validate(input: unknown): TLRecord }).validate(record);
  });
  const clean = exportRoomTemplate(records, value.name);
  clean.notices = [...value.notices, ...clean.notices.filter(n => n.reason !== 'content-reset')].slice(0, TEMPLATE_LIMITS.sourceRecords);
  bounded(clean); return clean;
}
export function instantiateRoomTemplate(input: unknown, options: { id?: () => string; now?: number } = {}): { records: TLRecord[]; notices: TemplateNotice[] } {
  const template = parseRoomTemplate(input), id = options.id ?? (() => crypto.randomUUID());
  const mapping = new Map<string, string>(), used = new Set<string>(template.records.map(r => r.id));
  for (const record of template.records) {
    const next = `${record.typeName}:${id()}`;
    if (!/^(page|shape|binding):[a-zA-Z0-9_-]{1,100}$/.test(next) || used.has(next)) throw new Error('ID generator must produce fresh unique IDs.');
    used.add(next); mapping.set(record.id, next);
  }
  const records = template.records.map(record => {
    const next = { ...structuredClone(record), id: mapping.get(record.id)! } as TLRecord;
    if (next.typeName === 'shape') {
      next.parentId = mapping.get(next.parentId)! as TLShape['parentId'];
      if (next.type === 'present-widget') next.props.createdAt = options.now ?? Date.now();
    }
    if (next.typeName === 'binding') { next.fromId = mapping.get(next.fromId)! as typeof next.fromId; next.toId = mapping.get(next.toId)! as typeof next.toId; }
    return next;
  });
  return { records, notices: template.notices };
}
