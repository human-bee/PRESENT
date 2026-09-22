import type { EvidenceReport } from '../../shared/evidence';
import { AgentError } from '../agents/contract';
import { randomUUID } from 'node:crypto';
import type { TLRecord, TLShape } from '@tldraw/tlschema';
import type { JsonObject } from '@tldraw/utils';
import { getCanvasRecords, transactCanvas } from '../room-store';
import { buildCanvasMutation } from '../agents/canvas-tools';
import type { CanvasCommand } from '../../shared/canvas-commands';
import { storedSceneSchema, validateScene, type Scene, type ScenePlan } from '../../shared/scenes';

export function readScenes(records: TLRecord[]): Scene[] {
  const value = records.find(r => r.typeName === 'document')?.meta.scenes;
  return Array.isArray(value) ? value.slice(0, 8).flatMap(raw => {
    const parsed = storedSceneSchema.safeParse(raw);
    if (!parsed.success) return [];
    try { validateScene(parsed.data.plan); return [parsed.data]; } catch { return []; }
  }) : [];
}
function commands(plan: ScenePlan): CanvasCommand[] {
  return plan.nodes.map(n => {
    const base = { ref: n.key, x: n.x, y: n.y, color: n.color, text: n.label };
    if (n.shape === 'draw') return { ...base, type: 'create_draw', points: n.points!, isClosed: false };
    if (n.shape === 'text') return { ...base, type: 'create_text', w: n.w };
    if (n.shape === 'arrow' || n.shape === 'line') return { ...base, type: 'create_arrow', start: { x: 0, y: 0 }, end: { x: n.w, y: n.h }, bend: 0 };
    return { ...base, type: 'create_geo', geo: n.shape, w: n.w, h: n.h, fill: n.shape === 'ellipse' ? 'semi' : 'none' };
  });
}

export function buildSceneShapes(plan: ScenePlan, pageId: string, records: TLRecord[], requestId: string, actor: string) {
  const built = buildCanvasMutation({ pageId, commands: commands(plan) }, records, actor, requestId);
  const shapes = built.mutation.creates!.filter((r): r is TLShape => r.typeName === 'shape');
  shapes.forEach((shape, i) => {
    shape.rotation = plan.nodes[i].rotation ?? 0;
    shape.opacity = plan.nodes[i].visible === false ? 0 : plan.nodes[i].opacity ?? 1;
    const props = shape.props as unknown as Record<string, unknown>;
    if (shape.type !== 'draw') props.font = 'sans'; props.size = 's';
    if (shape.type !== 'text') props.dash = 'solid';
    if (plan.nodes[i].shape === 'line') props.arrowheadEnd = 'none';
  });
  return shapes;
}

/** Each revision is one atomic native document transaction. Prior plans remain in the document. */
export function applyScene(roomId: string, pageId: string, plan: ScenePlan, sceneId: string | null, before: TLRecord[], prompt: string, provider: string, evidence?: EvidenceReport) {
  validateScene(plan);
  const revision = randomUUID();
  let applied!: Scene;
  transactCanvas(roomId, { plan, sceneId, revision }, `agent:${provider}`, records => {
    const scenes = readScenes(records), old = sceneId ? scenes.find(s => s.id === sceneId && s.pageId === pageId) : undefined;
    if (sceneId && !old) throw new AgentError('That scene no longer exists on this page.', 409);
    if (old) for (const id of Object.values(old.shapeIds)) {
      const expected = before.find(r => r.id === id), current = records.find(r => r.id === id);
      // An object missing in both snapshots can be restored by the requested revision.
      // A deletion or reappearance DURING planning remains a conflict.
      if (!expected && !current) continue;
      if (!expected || !current || JSON.stringify(expected) !== JSON.stringify(current) || (current.typeName === 'shape' && current.isLocked)) throw new AgentError('The scene changed while planning. Your changes are preserved; ask again.', 409);
    }
    const shapes = buildSceneShapes(plan, pageId, records, revision, `agent:${provider}`);
    const id = old?.id ?? randomUUID(), shapeIds: Record<string, string> = {};
    const creates: TLShape[] = [], updates: TLShape[] = [];
    shapes.forEach((source, i) => {
      let shape = source;
      const n = plan.nodes[i];
      const previous = old && records.find(r => r.id === old.shapeIds[n.key]);
      if (previous?.typeName === 'shape' && previous.type === shape.type) { shape = { ...shape, id: previous.id, index: previous.index, meta: { ...previous.meta, ...shape.meta } }; updates.push(shape); }
      else creates.push(shape);
      shapeIds[n.key] = shape.id;
      shape.meta = { ...shape.meta, sceneId: id, sceneKey: n.key };
      const props = shape.props as unknown as Record<string, unknown>;
      if (shape.type !== 'draw') props.font = 'sans'; props.size = 's';
      if (shape.type !== 'text') props.dash = 'solid';
      if (n.shape === 'line') props.arrowheadEnd = 'none';
    });
    const version = { revision, plan, prompt, provider, at: Date.now(), ...(evidence || old?.evidence ? { evidence: evidence ?? old?.evidence } : {}) };
    const history = old ? [...old.history, { revision: old.revision, plan: old.plan, prompt: old.prompt, provider: old.provider, at: old.at, ...(old.evidence ? { evidence: old.evidence } : {}) }].slice(-4) : [];
    applied = { ...version, id, pageId, shapeIds, history };
    if (!old && scenes.length >= 8) throw new Error('This room has eight animated scenes. Revise an existing scene.');
    return { creates, updates, deletes: old ? Object.values(old.shapeIds).filter(id => records.some(r => r.id === id) && !Object.values(shapeIds).includes(id)) : [], documentMeta: { scenes: [...scenes.filter(s => s.id !== id), applied] as unknown as JsonObject['scenes'] } };
  }, { requestId: revision });
  return applied;
}
export const scenesInRoom = (roomId: string) => readScenes(getCanvasRecords(roomId));
