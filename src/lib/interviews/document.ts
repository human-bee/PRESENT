import * as Y from 'yjs';
import { interviewAssetSchema, interviewSceneSchema } from '@present/contracts/interview-studio';
import {
  briefFields, briefSourceSchema, briefSuggestionSchema, interviewTranscriptSchema,
  type BriefField, type BriefSnapshot, type BriefSource,
} from '@present/contracts/interviews';

export const encodeState = (doc: Y.Doc) => btoa(
  Array.from(Y.encodeStateAsUpdate(doc), (byte) => String.fromCharCode(byte)).join(''),
);
export const decodeState = (encoded: string) => Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));

export function readBrief(doc: Y.Doc): BriefSnapshot {
  const fields = Object.fromEntries(briefFields.map((field) => [field, doc.getText(field).toString()])) as BriefSnapshot['fields'];
  const sources: BriefSnapshot['sources'] = {};
  for (const [key, value] of Array.from(doc.getMap('sources')).sort(([a], [b]) => a.localeCompare(b))) {
    const field = key.split(':')[0] as BriefField;
    const parsed = briefSourceSchema.safeParse(value);
    if (briefFields.includes(field) && parsed.success) (sources[field] ??= []).push(parsed.data);
  }
  const transcripts = Array.from(doc.getMap('transcripts').values()).flatMap((value) => {
    const parsed = interviewTranscriptSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }).sort((a, b) => a.timestamp - b.timestamp);
  const suggestions = Array.from(doc.getMap('suggestions').values()).flatMap((value) => {
    const parsed = briefSuggestionSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const activity = Array.from(doc.getMap<BriefSnapshot['activity'][number]>('activity').values())
    .filter((item) => typeof item?.text === 'string' && typeof item.timestamp === 'number')
    .sort((a, b) => b.timestamp - a.timestamp);
  const workspace = doc.getMap('studio');
  const scene = interviewSceneSchema.catch('meet').parse(workspace.get('scene'));
  const focus = briefFields.includes(workspace.get('focus') as BriefField) ? workspace.get('focus') as BriefField : 'work';
  const assets = Array.from(doc.getMap('assets').values()).flatMap((value) => {
    const parsed = interviewAssetSchema.safeParse(value);
    if (!parsed.success) return [];
    const layout = doc.getMap('asset-layout').get(parsed.data.id);
    const positioned = interviewAssetSchema.safeParse({ ...parsed.data, ...(typeof layout === 'object' && layout ? layout : {}) });
    return [positioned.success ? positioned.data : parsed.data];
  }).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { fields, sources, transcripts, suggestions, activity, studio: { scene, focus, assets } };
}

// Apply only the changed span so simultaneous Y.Text edits merge instead of replacing a field.
export function editBriefField(doc: Y.Doc, field: BriefField, next: string) {
  const text = doc.getText(field);
  const before = text.toString();
  let start = 0;
  while (start < before.length && start < next.length && before[start] === next[start]) start++;
  let end = 0;
  while (end < before.length - start && end < next.length - start
    && before[before.length - end - 1] === next[next.length - end - 1]) end++;
  doc.transact(() => {
    if (before.length - start - end) text.delete(start, before.length - start - end);
    if (next.length - start - end) text.insert(start, next.slice(start, next.length - end));
  }, 'editor');
}

export function setBriefSource(doc: Y.Doc, field: BriefField, source: BriefSource, id: string = crypto.randomUUID()) {
  doc.getMap('sources').set(`${field}:${id}`, source);
}

export function addBriefActivity(doc: Y.Doc, text: string) {
  const id = crypto.randomUUID();
  doc.getMap('activity').set(id, { id, text, timestamp: Date.now() });
}
