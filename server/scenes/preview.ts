import type { TLRecord, TLShape } from '@tldraw/tlschema';
import { scenePlanSchema, validateScene, type ScenePlan } from '../../shared/scenes';
import { buildSceneShapes } from './store';
import { getCanvasRecords, transactCanvas } from '../room-store';

/** Read only complete node objects from the known result.plan.nodes array in partial JSON. */
export function partialSceneNodes(text: string): unknown[] {
  if (!/^\s*\{\s*"result"\s*:\s*\{\s*"kind"\s*:\s*"scene"/.test(text)) return [];
  let depth = 0, arrayStart = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const start = i++; for (; i < text.length; i++) { if (text[i] === '\\') i++; else if (text[i] === '"') break; }
      if (i >= text.length) break;
      if (depth === 3 && text.slice(start, i + 1) === '"nodes"') {
        const match = text.slice(i + 1).match(/^\s*:\s*\[/);
        if (match) { arrayStart = i + 1 + match[0].length; break; }
      }
    } else if (text[i] === '{' || text[i] === '[') depth++;
    else if (text[i] === '}' || text[i] === ']') depth--;
  }
  if (arrayStart < 0) return [];
  const values: unknown[] = []; depth = 0; let start = -1;
  for (let i = arrayStart; i < text.length; i++) {
    if (text[i] === '"') { for (i++; i < text.length; i++) { if (text[i] === '\\') i++; else if (text[i] === '"') break; } }
    else if (text[i] === '{') { if (!depth) start = i; depth++; }
    else if (text[i] === '}') { if (--depth === 0 && start >= 0) { try { values.push(JSON.parse(text.slice(start, i + 1))); } catch { return values; } } }
    else if (text[i] === ']' && !depth) break;
  }
  return values;
}
export function scenePreview(roomId: string, pageId: string, requestId: string) {
  const started = performance.now(); let firstDraftMs: number | null = null, createdNodes = 0;
  let buffer = '', count = 0; const ids = new Set<string>();
  const clean = () => {
    if (!ids.size) { buffer = ''; count = 0; return; }
    const existing = getCanvasRecords(roomId).filter(r => r.typeName === 'shape' && ids.has(r.id) && r.meta.sceneDraft === requestId);
    if (existing.length) transactCanvas(roomId, { clearPreview: requestId }, 'scene:preview', () => ({ deletes: existing.map(r => r.id) }));
    ids.clear(); buffer = ''; count = 0;
  };
  return { clean, metrics: () => ({ firstDraftMs, createdNodes }), delta(chunk: string) {
    buffer += chunk;
    for (const raw of partialSceneNodes(buffer).slice(count)) {
      const index = count++;
      try {
        const node = scenePlanSchema.shape.nodes.element.parse(raw);
        const plan: ScenePlan = { title: 'Draft', explanation: 'Generation in progress', epistemic: 'illustration', duration: 1, autoplay: false, nodes: [node], tracks: [], beats: [{ at: 0, label: 'Draft' }] };
        validateScene(plan);
        transactCanvas(roomId, { preview: requestId, index }, 'scene:preview', records => {
          const shapes = buildSceneShapes(plan, pageId, records, `${requestId}_${index}`, 'preview');
          for (const shape of shapes) { shape.isLocked = true; shape.opacity = .55; shape.meta.sceneDraft = requestId; ids.add(shape.id); }
          return { creates: shapes };
        });
        firstDraftMs ??= Math.round(performance.now() - started); createdNodes++;
      } catch { /* Invalid/incomplete model geometry remains invisible until the full contract is repaired. */ }
    }
  } };
}
