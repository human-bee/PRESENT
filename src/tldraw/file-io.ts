import { AssetRecordType, PageRecordType, createBindingId, createShapeId, type TLAsset, type TLPage, type TLRecord, type TLShape } from '@tldraw/tlschema';
import { getIndexAbove } from '@tldraw/utils';
import type { Editor } from 'tldraw';
import { presentSchema } from '../../shared/tldraw-schema';
import { readTranscriptWindow } from '../../shared/transcript';
import { MAX_ASSET_BYTES, presentAssetStore } from './asset-store';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const documentTypes = new Set(['document', 'page', 'shape', 'binding', 'asset']);
const localAsset = /^\/api\/assets\/[a-f0-9]{64}\.(png|jpg|gif|webp|avif|mp4|webm|mov)$/;
const localMedia = /^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/;
const dataMedia = /^data:((?:image\/(?:png|jpeg|gif|webp|avif)|video\/(?:mp4|webm|quicktime)));base64,([A-Za-z0-9+/]+={0,2})$/;
const isLocalAsset = (value: string) => localAsset.test(value) || localMedia.test(value);
const title = (value: string) => [...value].filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').trim().slice(0, 100) || 'Imported canvas';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
type Upload = typeof presentAssetStore.upload;
type ImportPlan = { records: TLRecord[]; pages: TLPage[] };

function checkResources(value: unknown, key = '', depth = 0): void {
  if (depth > 30) throw new Error('This canvas contains data nested too deeply.');
  if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(name) || (/^(?:authorization|password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)$/i.test(name) && child)) throw new Error('Remove credentials and unsafe metadata before importing or exporting this canvas.');
      checkResources(child, name, depth + 1);
    }
  } else if (typeof value === 'string' && ['src', 'url', 'href', 'image', 'favicon'].includes(key) && value && !value.startsWith('data:') && !isLocalAsset(value)) {
    let url: URL; try { url = new URL(value); } catch { throw new Error('A canvas resource has an invalid URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(name => /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)$/i.test(name))) throw new Error('Canvas links must use HTTP(S) without embedded credentials.');
  }
}

/** Validate every source record, including unused assets the SDK parser normally prunes. */
export function parseNativeFile(json: string): TLRecord[] {
  if (new TextEncoder().encode(json).length > MAX_FILE_BYTES) throw new Error('Canvas files can be up to 100 MB.');
  try {
    const raw = JSON.parse(json);
    if (raw?.tldrawFileFormatVersion !== 1 || !Array.isArray(raw.records) || !raw.schema) throw new Error('This is not a supported .tldr canvas.');
    if (raw.records.length > 1000 || raw.records.some((record: TLRecord) => !record || typeof record.id !== 'string' || typeof record.typeName !== 'string') || new Set(raw.records.map((record: TLRecord) => record.id)).size !== raw.records.length) throw new Error('This canvas has too many records or duplicate record IDs.');
    const migrated = presentSchema.migrateStoreSnapshot({ schema: raw.schema, store: Object.fromEntries(raw.records.map((record: TLRecord) => [record.id, record])) });
    if (migrated.type === 'error') throw new Error('This canvas uses an unsupported native schema.');
    const records = Object.values(migrated.value).map(record => {
      const validator = presentSchema.types[record.typeName as TLRecord['typeName']] as { validate: (value: unknown) => TLRecord } | undefined;
      if (!validator) throw new Error('This canvas contains an unknown native record type.');
      return validator.validate(record);
    }).filter(record => documentTypes.has(record.typeName));
    checkResources(records);
    const map = new Map(records.map(record => [record.id, record]));
    const pages = records.filter(record => record.typeName === 'page');
    if (!pages.length) throw new Error('This canvas has no native pages.');
    const pageFor = (shape: TLShape): string => {
      let parent = map.get(shape.parentId); const seen = new Set([shape.id]);
      while (parent?.typeName === 'shape') {
        if (seen.has(parent.id)) throw new Error('This canvas contains a circular shape group.');
        seen.add(parent.id); parent = map.get(parent.parentId);
      }
      if (parent?.typeName !== 'page') throw new Error('A native shape is missing its parent page or group.');
      return parent.id;
    };
    for (const record of records) {
      if (record.typeName === 'shape') {
        pageFor(record);
        if ('assetId' in record.props && record.props.assetId && map.get(record.props.assetId)?.typeName !== 'asset') throw new Error('A native shape is missing its image, video or bookmark asset.');
      }
      if (record.typeName === 'binding') {
        const from = map.get(record.fromId), to = map.get(record.toId);
        if (from?.typeName !== 'shape' || to?.typeName !== 'shape' || from.type !== 'arrow' || pageFor(from) !== pageFor(to)) throw new Error('A native arrow binding is missing its arrow or target, or crosses pages.');
      }
    }
    return records;
  } catch (error) { throw new Error(error instanceof Error ? error.message : 'This canvas contains invalid native records.'); }
}

function decodeMedia(src: string, kind?: 'image' | 'video'): File {
  const match = dataMedia.exec(src);
  if (!match || (kind && !match[1].startsWith(`${kind}/`)) || match[2].length > Math.ceil(MAX_ASSET_BYTES / 3) * 4) throw new Error('Embedded images and videos must use a supported format and be at most 25 MB.');
  const decoded = atob(match[2]);
  if (!decoded.length || decoded.length > MAX_ASSET_BYTES) throw new Error('Embedded images and videos can be up to 25 MB.');
  return new File([Uint8Array.from(decoded, character => character.charCodeAt(0))], 'imported-media', { type: match[1] });
}

function assetSources(asset: TLAsset): string[] {
  return asset.type === 'bookmark' ? [asset.props.image, asset.props.favicon].filter(Boolean) : asset.props.src ? [asset.props.src] : [];
}
function validateAssets(records: TLRecord[]) {
  for (const asset of records.filter(record => record.typeName === 'asset')) {
    if (asset.type !== 'bookmark' && !asset.props.src) throw new Error('This canvas contains an image or video with no file.');
    for (const src of assetSources(asset)) {
      if (src.startsWith('data:')) decodeMedia(src, asset.type === 'bookmark' ? 'image' : asset.type);
      else if (!isLocalAsset(src)) throw new Error('Remote media is not fetched. Embed its image or video bytes in the .tldr file first.');
    }
  }
}

export async function prepareNativeImport(json: string, name: string, upload: Upload = presentAssetStore.upload): Promise<ImportPlan> {
  const records = parseNativeFile(json).filter(record => record.typeName !== 'document');
  validateAssets(records);
  const ids = new Map<string, string>(records.map(record => [record.id, record.typeName === 'page' ? PageRecordType.createId() : record.typeName === 'asset' ? AssetRecordType.createId() : record.typeName === 'binding' ? createBindingId() : createShapeId()]));
  const remap = (value: unknown): unknown => typeof value === 'string' ? ids.get(value) ?? value : Array.isArray(value) ? value.map(remap) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)])) : value;
  const imported = records.map(record => remap(record) as TLRecord);
  for (const asset of imported.filter(record => record.typeName === 'asset')) {
    const host = async (src: string, kind?: 'image' | 'video') => {
      if (!src.startsWith('data:')) return src;
      const result = await upload(asset, decodeMedia(src, kind));
      if (!localAsset.test(result.src)) throw new Error('The upload did not return a safe local asset.');
      return result.src;
    };
    if (asset.type === 'bookmark') { asset.props.image = await host(asset.props.image, 'image'); asset.props.favicon = await host(asset.props.favicon, 'image'); }
    else asset.props.src = await host(asset.props.src ?? '', asset.type);
  }
  const pages = imported.filter((record): record is TLPage => record.typeName === 'page').sort((a, b) => a.index.localeCompare(b.index));
  for (const page of pages) { page.name = title(`Imported · ${pages.length === 1 ? name.replace(/\.tldr$/i, '') : page.name}`); page.meta = {}; }
  for (const record of imported) presentSchema.types[record.typeName].validate(record);
  return { records: imported, pages };
}

function assertRoomFits(existing: TLRecord[], imported: TLRecord[]) {
  const records = [...existing.filter(record => documentTypes.has(record.typeName)), ...imported];
  if (records.filter(record => record.typeName === 'shape').length > 200 || records.length > 1000 || bytes(records) > 1_950_000 || imported.some(record => record.typeName === 'shape' && bytes(record) > 40_000)) throw new Error('This canvas would exceed the room capacity. Import it into a fresh room.');
}

async function waitForImport(roomId: string, records: TLRecord[]) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/room/${roomId}/document`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('The canvas was added locally but its room sync could not be confirmed. Keep the room open.');
    const data = await response.json();
    const ids = new Set((data.snapshot?.documents ?? []).map((document: { state?: { id?: string } }) => document.state?.id));
    if (records.every(record => ids.has(record.id))) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('The imported canvas is still waiting for room sync. Keep this room open.');
}

export async function importTldrawFile(editor: Editor, file: File, roomId: string): Promise<number> {
  if (!/^[a-f0-9]{24,64}$/.test(roomId)) throw new Error('A valid room is required to import a canvas.');
  if (editor.getIsReadonly()) throw new Error('Wait until this room is editable before importing.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Canvas files can be up to 100 MB.');
  const json = await file.text(), source = parseNativeFile(json);
  if (editor.getPages().length + source.filter(record => record.typeName === 'page').length > editor.options.maxPages) throw new Error('This import would exceed the room page limit.');
  if ([...editor.store.allRecords(), ...source].filter(record => record.typeName === 'shape').length > 200) throw new Error('This canvas would exceed the room capacity. Import it into a fresh room.');
  const plan = await prepareNativeImport(json, file.name);
  if (editor.getIsReadonly() || editor.getPages().length + plan.pages.length > editor.options.maxPages) throw new Error('The room changed while importing. Try again when it is editable.');
  assertRoomFits(editor.store.allRecords(), plan.records);
  let index = editor.getPages().at(-1)?.index;
  for (const page of plan.pages) { page.index = getIndexAbove(index); index = page.index; }
  editor.markHistoryStoppingPoint('Import a native canvas');
  editor.run(() => editor.store.put(plan.records));
  await waitForImport(roomId, plan.records);
  editor.setCurrentPage(plan.pages[0].id); editor.selectNone();
  editor.zoomToFit({ animation: { duration: 200 } });
  return plan.pages.length;
}

/** Use the SDK serializer with document records and an allowlisted asset resolver only. */
export function exportDocumentRecords(source: TLRecord[]): TLRecord[] {
  const records = structuredClone(source.filter(record => documentTypes.has(record.typeName)));
  const transcript = readTranscriptWindow(records);
  for (const record of records) if (record.typeName === 'document') record.meta = transcript.entries.length || transcript.omitted ? { present: { transcript: transcript.entries, ...(transcript.omitted ? { transcriptOmitted: transcript.omitted } : {}) } } : {};
  return records;
}

export async function exportTldrawFile(editor: Editor): Promise<string> {
  const { createTLStore, serializeTldrawJson, FileHelpers } = await import('tldraw');
  const records = exportDocumentRecords(editor.store.allRecords());
  checkResources(records); validateAssets(records);
  for (const asset of records.filter(record => record.typeName === 'asset' && record.type === 'bookmark')) {
    const embed = async (src: string) => {
      if (!src || src.startsWith('data:')) return src;
      const response = await fetch(src, { credentials: 'same-origin', redirect: 'error' });
      if (!response.ok) throw new Error('A bookmark image could not be embedded.');
      return FileHelpers.blobToDataUrl(await response.blob());
    };
    asset.props.image = await embed(asset.props.image); asset.props.favicon = await embed(asset.props.favicon);
  }
  const store = createTLStore({ schema: editor.store.schema, initialData: Object.fromEntries(records.map(record => [record.id, record])) });
  try {
    const json = await serializeTldrawJson({ store, resolveAssetUrl: async (id: string) => { const asset = store.get(id as TLAsset['id']); return asset?.typeName === 'asset' && asset.props.src && isLocalAsset(asset.props.src) ? asset.props.src : null; } } as unknown as Editor);
    const exported = parseNativeFile(json); validateAssets(exported);
    if (exported.some(record => record.typeName === 'asset' && assetSources(record).some(src => !src.startsWith('data:')))) throw new Error('A local image or video could not be embedded in this export.');
    return json;
  } finally { store.dispose(); }
}

export async function downloadTldrawFile(editor: Editor, name: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([await exportTldrawFile(editor)], { type: 'application/vnd.tldraw+json' }));
  try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title(name).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'present-room'}.tldr`; anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
