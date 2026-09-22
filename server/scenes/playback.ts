import { b64Vecs, type TLShape, type TLShapePartial } from '@tldraw/tlschema';
import { getCanvasRecords, transactCanvas } from '../room-store';
import { poseAt, type Scene, type SceneControl } from '../../shared/scenes';
import { scenesInRoom } from './store';
type Playback = { time: number; speed: number; playing: boolean; error: string; timer?: ReturnType<typeof setInterval>; expected: Map<string, string>; tickAt: number };
const runs = new Map<string, Playback>();
const key = (room: string, scene: string) => `${room}:${scene}`;
const snapshot = (roomId: string, scene: Scene) => new Map(getCanvasRecords(roomId).filter(r => r.typeName === 'shape' && Object.values(scene.shapeIds).includes(r.id)).map(r => [r.id, JSON.stringify(r)]));
function run(roomId: string, scene: Scene) {
  const id = key(roomId, scene.id);
  if (!runs.has(id)) runs.set(id, { time: 0, speed: 1, playing: false, error: '', expected: snapshot(roomId, scene), tickAt: 0 });
  return runs.get(id)!;
}
export function pauseScene(roomId: string, sceneId: string) {
  const value = runs.get(key(roomId, sceneId));
  if (value) { clearInterval(value.timer); value.timer = undefined; value.playing = false; }
}
export function forgetSceneRun(roomId: string, sceneId: string) { pauseScene(roomId, sceneId); runs.delete(key(roomId, sceneId)); }
export function playbackState(roomId: string, scene: Scene) {
  const v = run(roomId, scene);
  return { time: v.time, speed: v.speed, playing: v.playing, error: v.error };
}
function frame(roomId: string, scene: Scene, v: Playback) {
  transactCanvas(roomId, { sceneId: scene.id, time: v.time }, 'scene:playback', records => {
    const updates: TLShapePartial[] = [];
    for (const track of scene.plan.tracks) {
      const id = scene.shapeIds[track.key], shape = records.find(r => r.id === id);
      if (shape?.typeName !== 'shape') throw new Error(`Playback paused: the animated object “${track.key}” is missing. Undo its deletion or ask PRESENT to restore that object.`);
      if (shape.isLocked) throw new Error(`Playback paused: the animated object “${track.key}” is locked. Unlock it to continue.`);
      if (JSON.stringify(shape) !== v.expected.get(id)) throw new Error(`Playback paused: the animated object “${track.key}” changed since playback began. Ask to revise the scene from its current state.`);
      const pose = poseAt(track.poses, v.time);
      const props: Record<string, unknown> = {};
      if (shape.type === 'arrow' && (pose.w !== undefined || pose.h !== undefined)) {
        const node = scene.plan.nodes.find(n => n.key === track.key)!;
        props.end = { x: pose.w ?? node.w, y: pose.h ?? node.h };
      } else if (shape.type === 'geo' || shape.type === 'text') {
        if (pose.w !== undefined) props.w = pose.w;
        if (pose.h !== undefined && shape.type === 'geo') props.h = pose.h;
      }
      if (shape.type === 'draw' && pose.points) props.segments = [{ type: 'free', path: b64Vecs.encodePoints(pose.points.map(p => ({ ...p, z: .5 }))) }];
      const node = scene.plan.nodes.find(n => n.key === track.key)!;
      updates.push({ id: shape.id, type: shape.type, x: pose.x, y: pose.y,
        ...(pose.rotation !== undefined ? { rotation: pose.rotation } : {}),
        ...(pose.opacity !== undefined || pose.visible !== undefined ? { opacity: pose.visible === false ? 0 : pose.opacity ?? node.opacity ?? 1 } : {}),
        props,
      } as TLShapePartial);
    }
    return { updates };
  });
  v.expected = snapshot(roomId, scene);
}
export function controlScene(roomId: string, input: SceneControl) {
  const scene = scenesInRoom(roomId).find(s => s.id === input.sceneId);
  if (!scene) throw new Error('That scene is missing.');
  const v = run(roomId, scene);
  pauseScene(roomId, scene.id);
  if (input.action === 'pause') return playbackState(roomId, scene);
  if (input.action === 'seek' && input.time === undefined) throw new Error('Seeking requires a time.');
  if (input.action === 'restart') v.time = 0;
  if (input.action === 'seek') v.time = Math.min(scene.plan.duration, input.time!);
  if (['slow', 'normal', 'fast'].includes(input.action)) v.speed = input.action === 'slow' ? .5 : input.action === 'fast' ? 2 : 1;
  try {
    if (input.action === 'seek' || input.action === 'restart') frame(roomId, scene, v);
    if (input.action !== 'seek') {
      if (v.time >= scene.plan.duration) { v.time = 0; frame(roomId, scene, v); }
      v.playing = true; v.tickAt = performance.now();
      v.timer = setInterval(() => {
        try {
          const now = performance.now(); v.time = Math.min(scene.plan.duration, v.time + (now - v.tickAt) / 1000 * v.speed); v.tickAt = now;
          frame(roomId, scene, v);
          if (v.time >= scene.plan.duration) pauseScene(roomId, scene.id);
        } catch (e) { v.error = e instanceof Error ? e.message : 'Playback stopped'; pauseScene(roomId, scene.id); }
      }, 100);
      v.timer.unref();
    }
    v.error = '';
  } catch (e) { v.error = e instanceof Error ? e.message : 'Playback stopped'; throw e; }
  return playbackState(roomId, scene);
}
export function closeScenes() { for (const v of runs.values()) clearInterval(v.timer); runs.clear(); }
