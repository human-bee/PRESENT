import type { TLShapeId } from '@tldraw/tlschema';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { randomBytes } from 'node:crypto';
import { validateScene, poseAt, decodeScenePlan, type ScenePlan } from '../shared/scenes';
import { getCanvasRecords, mutateCanvas, closeRoomStore } from '../server/room-store';
import { applyScene, scenesInRoom } from '../server/scenes/store';
import { controlScene, forgetSceneRun } from '../server/scenes/playback';
const plan: ScenePlan = { title: 'Flow', explanation: 'Illustrative flow', epistemic: 'illustration', duration: 2, autoplay: false,
  nodes: [{ key: 'token', shape: 'ellipse', x: 0, y: 0, w: 54, h: 54, label: '1', color: 'blue' }],
  tracks: [{ key: 'token', poses: [{ at: 0, x: 0, y: 0 }, { at: 2, x: 100, y: 50 }] }], beats: [{ at: 0, label: 'Begin' }] };
test('scene contract rejects ambiguous identity and broken trajectories', () => {
  validateScene(plan);
  assert.throws(() => validateScene({ ...plan, nodes: [...plan.nodes, ...plan.nodes] }), /unique/);
  assert.throws(() => validateScene({ ...plan, tracks: [{ ...plan.tracks[0], key: 'missing' }] }), /unique scene node/);
  assert.throws(() => validateScene({ ...plan, duration: 3 }), /span/);
  assert.deepEqual(poseAt(plan.tracks[0].poses, 1), { x: 50, y: 25 });
});
test('native scene revision, manual-edit protection and unrelated shapes', () => {
  const room = randomBytes(16).toString('hex');
  const before = getCanvasRecords(room);
  const scene = applyScene(room, 'page:page', plan, null, before, 'Show a flow', 'luna');
  controlScene(room, { sceneId: scene.id, action: 'seek', time: 1 });
  let records = getCanvasRecords(room);
  const shape = records.find(r => r.id === scene.shapeIds.token)!;
  assert.equal(shape.typeName === 'shape' && shape.x, 50);
  mutateCanvas(room, { updates: [{ id: shape.id as TLShapeId, type: 'geo', x: 70 }] }, 'human');
  assert.throws(() => controlScene(room, { sceneId: scene.id, action: 'seek', time: 2 }), /changed since playback began/);
  assert.throws(() => applyScene(room, 'page:page', plan, scene.id, records, 'Revise', 'luna'), /changed while planning/);
  records = getCanvasRecords(room);
  const revised = applyScene(room, 'page:page', { ...plan, epistemic: 'hypothesis' }, scene.id, records, 'What if?', 'luna');
  assert.equal(revised.history.length, 1);
  assert.equal(revised.shapeIds.token, scene.shapeIds.token);
  assert.equal(scenesInRoom(room)[0].plan.epistemic, 'hypothesis');
  forgetSceneRun(room, scene.id);
});

after(() => closeRoomStore());

test('partial stream reads complete nodes only and ignores quoted keys', async () => {
  const { partialSceneNodes } = await import('../server/scenes/preview');
  const text = JSON.stringify({ result: { kind: 'scene', sceneId: null, plan } });
  assert.equal(partialSceneNodes(text).length, 1);
  assert.equal(partialSceneNodes(text.slice(0, text.indexOf('"tracks"'))).length, 1);
  assert.deepEqual(partialSceneNodes(JSON.stringify({ result: { kind: 'note', text: 'nodes' } })), []);
});

test('normalized model trajectories expand to complete timelines without guessing motion', () => {
  const decoded = decodeScenePlan({ ...plan, tracks: [{ key: 'token', waypoints: [{ progress: .5, x: 30, y: 10 }], end: { x: 100, y: 50 } }] });
  validateScene(decoded);
  assert.deepEqual(decoded.tracks[0].poses, [{ at: 0, x: 0, y: 0 }, { at: 1, x: 30, y: 10 }, { at: 2, x: 100, y: 50 }]);
});

test('complex scenes create and revise 80 nodes with 40 motion tracks without simplifying', async () => {
  const { readCanvas } = await import('../server/agents/canvas-tools');
  const room = randomBytes(16).toString('hex');
  const nodes = Array.from({ length: 80 }, (_, i) => ({ ...plan.nodes[0], key: `actor${i}`, x: i * 60, label: String(i) }));
  const tracks = nodes.slice(0, 40).map(n => ({ key: n.key, poses: [{ at: 0, x: n.x, y: n.y }, { at: 90, x: n.x + 100, y: 50 }] }));
  const complex = { ...plan, duration: 90, nodes, tracks };
  const first = applyScene(room, 'page:page', complex, null, getCanvasRecords(room), 'Detailed scene', 'luna');
  const extra = applyScene(room, 'page:page', plan, null, getCanvasRecords(room), 'Selected reference', 'luna');
  const observed = readCanvas(room, 'page:page', [extra.shapeIds.token]);
  assert.equal(observed.truncated, true);
  assert.equal(observed.shapes[0].id, extra.shapeIds.token);
  const revised = applyScene(room, 'page:page', { ...complex, title: 'Revised detailed scene' }, first.id, getCanvasRecords(room), 'Revise without simplifying', 'luna');
  assert.equal(revised.plan.nodes.length, 80);
  assert.equal(revised.plan.tracks.length, 40);
  assert.deepEqual(revised.shapeIds, first.shapeIds);
  controlScene(room, { sceneId: revised.id, action: 'seek', time: 45 });
  const moved = getCanvasRecords(room).find(r => r.id === revised.shapeIds.actor39);
  assert.equal(moved?.typeName === 'shape' && moved.x, 39 * 60 + 50);
  forgetSceneRun(room, revised.id);
});

test('playback identifies a missing animated object instead of attributing a human edit', () => {
  const room = randomBytes(16).toString('hex');
  const scene = applyScene(room, 'page:page', plan, null, getCanvasRecords(room), 'Flow', 'luna');
  mutateCanvas(room, { deletes: [scene.shapeIds.token] }, 'human');
  assert.throws(() => controlScene(room, { sceneId: scene.id, action: 'seek', time: 1 }), /object “token” is missing/);
  forgetSceneRun(room, scene.id);
});

test('scene repair restores an already missing object but rejects deletion during planning', () => {
  const room = randomBytes(16).toString('hex');
  const original = applyScene(room, 'page:page', plan, null, getCanvasRecords(room), 'Flow', 'luna');
  const beforeDeletion = getCanvasRecords(room);
  mutateCanvas(room, { deletes: [original.shapeIds.token] }, 'human');
  assert.throws(() => applyScene(room, 'page:page', plan, original.id, beforeDeletion, 'Revise', 'terra'), /changed while planning/);
  const repaired = applyScene(room, 'page:page', plan, original.id, getCanvasRecords(room), 'Restore the missing token', 'terra');
  assert.equal(repaired.id, original.id);
  assert.equal(repaired.history.length, 1);
  assert.ok(getCanvasRecords(room).some(r => r.id === repaired.shapeIds.token));
  controlScene(room, { sceneId: repaired.id, action: 'seek', time: 1 });
  const token = getCanvasRecords(room).find(r => r.id === repaired.shapeIds.token);
  assert.equal(token?.typeName === 'shape' && token.x, 50);
  forgetSceneRun(room, repaired.id);
});


test('a populated room accepts a full animated scene and clears only its previews', async () => {
  const { scenePreview } = await import('../server/scenes/preview');
  const room = randomBytes(16).toString('hex');
  const nodes = Array.from({ length: 80 }, (_, i) => ({ ...plan.nodes[0], key: `actor${i}`, x: i * 60 }));
  const detailed = { ...plan, nodes, tracks: nodes.slice(0, 40).map(n => ({ key: n.key, poses: [{ at: 0, x: n.x, y: 0 }, { at: 2, x: n.x + 100, y: 50 }] })) };
  for (let i = 0; i < 3; i++) applyScene(room, 'page:page', detailed, null, getCanvasRecords(room), 'Existing diagram', 'luna');
  const before = getCanvasRecords(room).filter(r => r.typeName === 'shape');
  assert.equal(before.length, 240);
  const preview = scenePreview(room, 'page:page', 'capacity-preview');
  preview.delta(JSON.stringify({ result: { kind: 'scene', sceneId: null, plan: detailed } }));
  assert.equal(preview.metrics().createdNodes, 80);
  preview.clean();
  assert.deepEqual(getCanvasRecords(room).filter(r => r.typeName === 'shape'), before);
  const scene = applyScene(room, 'page:page', detailed, null, getCanvasRecords(room), 'New animation', 'luna');
  assert.equal(getCanvasRecords(room).filter(r => r.typeName === 'shape').length, 320);
  controlScene(room, { sceneId: scene.id, action: 'seek', time: 1 });
  const moved = getCanvasRecords(room).find(r => r.id === scene.shapeIds.actor39);
  assert.equal(moved?.typeName === 'shape' && moved.x, 39 * 60 + 50);
  forgetSceneRun(room, scene.id);
});

test('articulated limbs, morphing strokes and discrete poses seek and rewind as native shapes', async () => {
  const { b64Vecs } = await import('@tldraw/tlschema');
  const room = randomBytes(16).toString('hex');
  const nodes: ScenePlan['nodes'] = [
    { ...plan.nodes[0], key: 'leftArm', shape: 'line', x: 0, y: 0, w: 50, h: 50 },
    { ...plan.nodes[0], key: 'rightArm', shape: 'line', x: 100, y: 0, w: -50, h: 50 },
    { ...plan.nodes[0], key: 'stroke', shape: 'draw', points: [{ x: 0, y: 0 }, { x: 25, y: 50 }, { x: 50, y: 50 }], visible: false },
  ];
  const changedPoints = [{ x: 0, y: 0 }, { x: 25, y: -25 }, { x: 50, y: -50 }];
  const animated = decodeScenePlan({ ...plan, nodes, tracks: [
    ...nodes.slice(0, 2).map(n => ({ key: n.key, waypoints: [{ progress: .5, x: n.x, y: 0, w: n.w, h: -50 }], end: { x: n.x, y: 0, w: n.w, h: 50 } })),
    { key: 'stroke', waypoints: [{ progress: .5, x: 0, y: 0, visible: true, opacity: .5, rotation: 1, points: changedPoints }], end: { x: 0, y: 0, visible: false, opacity: 1, rotation: 0, points: nodes[2].points! } },
  ] });
  validateScene(animated);
  const scene = applyScene(room, 'page:page', animated, null, getCanvasRecords(room), 'High-five', 'luna');
  const shape = (key: string) => getCanvasRecords(room).find(r => r.id === scene.shapeIds[key]) as import('@tldraw/tlschema').TLShape;
  assert.equal(shape('stroke').opacity, 0);
  controlScene(room, { sceneId: scene.id, action: 'seek', time: .5 });
  assert.equal(shape('stroke').opacity, 0, 'visibility holds until its keyframe');
  controlScene(room, { sceneId: scene.id, action: 'seek', time: 1 });
  const left = shape('leftArm'), right = shape('rightArm'), stroke = shape('stroke');
  assert.ok(left.type === 'arrow' && right.type === 'arrow' && stroke.type === 'draw');
  assert.deepEqual({ x: left.x + left.props.end.x, y: left.y + left.props.end.y }, { x: right.x + right.props.end.x, y: right.y + right.props.end.y }, 'palms meet');
  assert.equal(left.props.end.y, -50, 'limb geometry changes');
  assert.equal(stroke.opacity, .5);
  assert.equal(stroke.rotation, 1);
  assert.deepEqual(b64Vecs.decodePoints(stroke.props.segments[0].path).map(({ x, y }) => ({ x, y })), changedPoints);
  controlScene(room, { sceneId: scene.id, action: 'seek', time: 0 });
  assert.equal(shape('stroke').opacity, 0);
  const reset = shape('leftArm'); assert.ok(reset.type === 'arrow'); assert.equal(reset.props.end.y, 50);
  const invalid = structuredClone(animated); invalid.tracks[2].poses[1].points!.pop();
  assert.throws(() => validateScene(invalid), /same stroke point count/);
  const incomplete = structuredClone(animated); delete incomplete.tracks[0].poses[1].h;
  assert.throws(() => validateScene(incomplete), /Every pose/);
  forgetSceneRun(room, scene.id);
});
