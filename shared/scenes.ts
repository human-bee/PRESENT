import { z } from 'zod';
import { evidenceReportSchema, type EvidenceReport } from './evidence';
const coord = z.number().finite().min(-100000).max(100000);
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const point = z.object({ x: coord, y: coord }).strict();
const poseFields = {
  x: coord, y: coord,
  rotation: z.number().finite().min(-Math.PI * 8).max(Math.PI * 8).optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  w: z.number().min(-4000).max(4000).optional(),
  h: z.number().min(-4000).max(4000).optional(),
  points: z.array(point).min(2).max(64).optional(),
};
export const scenePlanSchema = z.object({
  title: z.string().min(1).max(120),
  explanation: z.string().min(1).max(1600),
  epistemic: z.enum(['illustration', 'hypothesis']),
  duration: z.number().min(1).max(90),
  autoplay: z.boolean(),
  nodes: z.array(z.object({
    key, shape: z.enum(['rectangle', 'ellipse', 'text', 'arrow', 'line', 'draw']),
    ...poseFields, w: z.number().min(-4000).max(4000), h: z.number().min(-4000).max(4000),
    label: z.string().max(500), color: z.enum(['black', 'grey', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'red', 'violet']),
  }).strict()).min(1).max(80),
  tracks: z.array(z.object({ key, poses: z.array(z.object({ at: z.number().min(0).max(90), ...poseFields }).strict()).min(2).max(16) }).strict()).max(40),
  beats: z.array(z.object({ at: z.number().min(0).max(90), label: z.string().min(1).max(160) }).strict()).min(1).max(16),
}).strict();
export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type SceneVersion = { revision: string; plan: ScenePlan; prompt: string; provider: string; at: number; evidence?: EvidenceReport };
export type Scene = SceneVersion & { id: string; pageId: string; shapeIds: Record<string, string>; history: SceneVersion[] };
export const sceneControlSchema = z.object({ sceneId: z.string().min(1).max(100), action: z.enum(['play', 'pause', 'restart', 'seek', 'slow', 'normal', 'fast']), time: z.number().min(0).max(90).optional() }).strict();
export type SceneControl = z.infer<typeof sceneControlSchema>;
/** Semantic invariants are checked after schema decoding, before any canvas write. */
export function validateScene(plan: ScenePlan) {
  const keys = new Set(plan.nodes.map(n => n.key));
  if (keys.size !== plan.nodes.length) throw new Error('Scene node keys must be unique.');
  for (const n of plan.nodes) {
    if (!['arrow', 'line', 'draw'].includes(n.shape) && (n.w < 1 || n.h < 1)) throw new Error('Shapes need positive dimensions.');
    if (['arrow', 'line'].includes(n.shape) && Math.hypot(n.w, n.h) < 4) throw new Error(`Node ${n.key}: arrows/lines need nonzero endpoint offsets; do not emit placeholders at the origin.`);
    if (n.shape === 'ellipse' && n.w < 100 && n.label.length > 3) throw new Error(`Node ${n.key}: small marker labels must be at most 3 characters; put names in separate text nodes or a legend.`);
  }
  for (const n of plan.nodes) {
    if (n.shape === 'draw' && !n.points) throw new Error('Draw nodes require local stroke points.');
    if (n.shape !== 'draw' && n.points) throw new Error('Only draw nodes accept stroke points.');
  }
  const tracks = new Set<string>();
  for (const track of plan.tracks) {
    if (!keys.has(track.key) || tracks.has(track.key)) throw new Error('Every track needs one unique scene node.');
    tracks.add(track.key);
    if (track.poses[0].at !== 0 || track.poses.at(-1)!.at !== plan.duration) throw new Error('Tracks must span zero to scene duration.');
    if (track.poses.some((p, i) => p.at > plan.duration || (i > 0 && p.at <= track.poses[i - 1].at))) throw new Error('Track times must increase strictly.');
    const node = plan.nodes.find(n => n.key === track.key)!;
    for (const field of ['rotation', 'opacity', 'visible', 'w', 'h', 'points'] as const) {
      if (track.poses.some(p => p[field] !== undefined) && track.poses.some(p => p[field] === undefined)) throw new Error(`Every pose must specify animated ${field}.`);
      const initial = node[field] ?? (field === 'rotation' ? 0 : field === 'opacity' ? 1 : field === 'visible' ? true : undefined);
      if (track.poses[0][field] !== undefined && JSON.stringify(track.poses[0][field]) !== JSON.stringify(initial)) throw new Error(`A track must start at its node ${field}.`);
    }
    for (const p of track.poses) {
      if (p.points && (node.shape !== 'draw' || p.points.length !== node.points?.length)) throw new Error('Morph poses require the same stroke point count as their draw node.');
      if (p.w !== undefined || p.h !== undefined) {
        if (node.shape === 'draw') throw new Error('Animate draw geometry through points.');
        if (['arrow', 'line'].includes(node.shape)) {
          if (Math.hypot(p.w ?? node.w, p.h ?? node.h) < 4) throw new Error('Animated line endpoints must be nonzero.');
        } else if ((p.w ?? node.w) < 1 || (p.h ?? node.h) < 1) throw new Error('Animated dimensions must be positive.');
      }
    }
    if (node.x !== track.poses[0].x || node.y !== track.poses[0].y) throw new Error('A track must start at its node position.');
  }
  if (plan.beats.some((b, i) => b.at > plan.duration || (i > 0 && b.at <= plan.beats[i - 1].at))) throw new Error('Beat times must increase within duration.');
}
export function poseAt(poses: ScenePlan['tracks'][number]['poses'], time: number) {
  const end = poses.findIndex(p => p.at >= time);
  if (end <= 0) return end === 0 ? poses[0] : poses.at(-1)!;
  const a = poses[end - 1], b = poses[end], t = (time - a.at) / (b.at - a.at);
  const result: Omit<ScenePlan['tracks'][number]['poses'][number], 'at'> = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  for (const field of ['rotation', 'opacity', 'w', 'h'] as const) {
    if (a[field] !== undefined && b[field] !== undefined) result[field] = a[field]! + (b[field]! - a[field]!) * t;
  }
  if (a.visible !== undefined) result.visible = time < b.at ? a.visible : b.visible;
  if (a.points && b.points) result.points = a.points.map((p, i) => ({ x: p.x + (b.points![i].x - p.x) * t, y: p.y + (b.points![i].y - p.y) * t }));
  return result;
}

/** Model contract avoids redundant start/end timestamps. Code maps normalized time to seconds. */
export const sceneRequestPlanSchema = scenePlanSchema.omit({ tracks: true }).extend({
  tracks: z.array(z.object({ key,
    waypoints: z.array(z.object({ progress: z.number().gt(0).lt(1), ...poseFields }).strict()).max(6),
    end: z.object(poseFields).strict(),
  }).strict()).max(40),
}).strict();
export function decodeScenePlan(input: z.infer<typeof sceneRequestPlanSchema>): ScenePlan {
  return { ...input, tracks: input.tracks.map(track => {
    const node = input.nodes.find(n => n.key === track.key);
    if (!node) throw new Error('Every track needs an existing scene node.');
    const start: ScenePlan['tracks'][number]['poses'][number] = { at: 0, x: node.x, y: node.y };
    for (const field of ['rotation', 'opacity', 'visible', 'w', 'h', 'points'] as const) {
      if (track.end[field] !== undefined || track.waypoints.some(p => p[field] !== undefined)) {
        Object.assign(start, { [field]: node[field] ?? (field === 'rotation' ? 0 : field === 'opacity' ? 1 : field === 'visible' ? true : undefined) });
      }
    }
    return { key: track.key, poses: [start, ...track.waypoints.map(({ progress, ...pose }) => ({ at: progress * input.duration, ...pose })), { at: input.duration, ...track.end }] };
  }) };
}

const sceneVersionSchema = z.object({ revision: z.string().max(100), plan: scenePlanSchema, prompt: z.string().max(3000), provider: z.string().max(80), at: z.number().finite(), evidence: evidenceReportSchema.optional() });
export const storedSceneSchema = sceneVersionSchema.extend({ id: z.string().max(100), pageId: z.string().regex(/^page:[\w-]{1,100}$/), shapeIds: z.record(key, z.string().regex(/^shape:[\w-]{1,100}$/)), history: z.array(sceneVersionSchema).max(4) });
