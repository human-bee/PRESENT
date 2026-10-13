import { createHash, randomUUID } from 'node:crypto';
import { getIndexAbove } from '@tldraw/utils';
import type { TLRecord, TLParentId } from '@tldraw/tlschema';
import { makeObject } from '../../shared/room';
import { objectToShape } from '../../shared/tldraw-adapter';
import { continuityItemSchema, type ContinuityApply, type ContinuityPreview } from '../../shared/room-continuity';
import { presentSchema } from '../../shared/tldraw-schema';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function plainText(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('Text is too deeply nested.');
  const node = object(value);
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  if (node.content.length > 1000) throw new Error('Text is too large.');
  const text = node.content.map(item => plainText(item, depth + 1)).join(node.type === 'doc' ? '\n' : '');
  if (text.length > 4000) throw new Error('Text is too large.');
  return text;
}
/** Explicit visible text only. Ambient document metadata, HTML, assets and work state never enter the preview. */
export function previewContinuity(sourceRoomId: string, records: readonly TLRecord[]): ContinuityPreview {
  if (records.length > 10000) throw new Error('This room exceeds the continuity preview limit.');
  const items: ContinuityPreview['items'] = []; let omitted = 0;
  for (const record of records) {
    if (record.typeName !== 'shape') continue;
    try {
      let text = '', kind: 'native-text' | 'markdown-artifact' = 'native-text';
      if (record.type === 'note' || record.type === 'text' || record.type === 'geo') text = plainText(record.props.richText).trim();
      else if (record.type === 'present-widget' && record.props.kind === 'widget' && record.props.data.capability === 'artifact' && record.props.data.format === 'markdown') {
        const markdown = object(record.props.data.state).markdown;
        if (typeof markdown === 'string') text = markdown.trim(); kind = 'markdown-artifact';
      }
      if (!text || items.length >= 100) { omitted++; continue; }
      items.push(continuityItemSchema.parse({ sourceObjectId: record.id, kind, text, digest: digest([sourceRoomId, record.id, kind, text]) }));
    } catch { omitted++; }
  }
  return { sourceRoomId, items, omitted };
}
export function selectedContinuity(input: ContinuityApply, records: readonly TLRecord[]) {
  const preview = previewContinuity(input.sourceRoomId, records);
  if (new Set(input.selection.map(item => item.sourceObjectId)).size !== input.selection.length) throw new Error('Select each source item only once.');
  return input.selection.map(selection => {
    const current = preview.items.find(item => item.sourceObjectId === selection.sourceObjectId);
    if (!current || current.digest !== selection.digest) throw new Error('Selected source content changed or is no longer available. Refresh the preview before carrying it forward.');
    return { ...current, text: selection.text, corrected: selection.text !== current.text };
  });
}
export function continuityRecords(input: ContinuityApply, source: readonly TLRecord[], now = Date.now()): TLRecord[] {
  const selected = selectedContinuity(input, source), pageId = `page:${randomUUID()}` as TLParentId;
  const page = presentSchema.types.page.validate({ id: pageId, typeName: 'page', name: 'Carried forward', index: getIndexAbove(), meta: {} } as TLRecord) as TLRecord;
  let index = getIndexAbove();
  return [page, ...selected.map((item, position) => {
    const note = { ...makeObject('note', '', { x: (position % 3) * 400, y: Math.floor(position / 3) * 400 }, { text: item.text, continuity: { sourceRoomId: input.sourceRoomId, sourceObjectId: item.sourceObjectId, sourceDigest: item.digest, kind: item.kind, corrected: item.corrected, copiedAt: now } }), id: `carried-${randomUUID()}`, title: item.kind === 'markdown-artifact' ? 'Carried source excerpt' : 'Carried decision or note', createdAt: now };
    const shape = objectToShape(note, { parentId: pageId, index }); index = getIndexAbove(index); return shape;
  })];
}
