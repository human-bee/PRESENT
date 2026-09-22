import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { TLShape } from '@tldraw/tlschema';
import { json } from './http';
import { applyOperation, getRoom, getCanvasRecords } from './room-store';
import { createCapability } from '../src/widgets/packs';
import { makeObject } from '../shared/room';
import { decideReactive } from './agents/reactive-decisions';
import { applyReactive } from './agents/apply-reactive';
import { reactiveStories } from '../scripts/benchmarks/reactive-stories';
const active = new Set<string>();
const requestSchema = z.object({ engine: z.enum(['jev', 'luna', 'cerebras']), story: z.number().int().min(0).max(1), step: z.number().int().min(0).max(5) }).strict();
/** Matched fixtures only. These rooms contain synthetic role-play, never imported human conversations. */
export async function handleReactiveBenchmark(req: IncomingMessage, res: ServerResponse) {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/api/benchmark/reactive') return false;
  if (req.method === 'GET') { json(res, 200, { stories: reactiveStories, rooms: JSON.parse(readFileSync('.data/benchmark-rooms.json', 'utf8')) }); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'Use POST' }); return true; }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1000) { json(res, 413, { error: 'Too large' }); return true; } }
  let value: unknown; try { value = JSON.parse(raw); } catch { json(res, 400, { error: 'Invalid JSON' }); return true; }
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) { json(res, 400, { error: 'Choose a synthetic reactive fixture' }); return true; }
  const { engine, story, step } = parsed.data;
  if (active.has(engine)) { json(res, 429, { error: 'This lane is running' }); return true; }
  active.add(engine);
  const started = performance.now();
  try {
    const rooms = JSON.parse(readFileSync('.data/benchmark-rooms.json', 'utf8'));
    const roomId = rooms[`${engine}:${story === 0 ? 2 : 0}`];
    if (!roomId) throw new Error('No reserved synthetic room for this engine. Run the creation lab first.');
    const fixture = reactiveStories[story], input = fixture.steps[step];
    const widgetId = 'reactive_' + fixture.capability, noteId = 'reactive_note_' + fixture.capability;
    if (!getRoom(roomId).objects.some(o => o.id === widgetId)) {
      const widget = createCapability(fixture.capability, 'Demo setup', { x: 80, y: 120 });
      widget.id = widgetId; widget.title = engine + ' · ' + fixture.name;
      const state = widget.data.state as Record<string, unknown>;
      if (fixture.capability === 'debate') for (const [id, text] of [['async', 'Async reviews reduce interruptions.'], ['speed', 'Live meetings resolve disagreements faster.']]) state['claim:' + id] = { id, text, side: 'Affirmative', status: 'pending', quotedEvidence: '', sourceURLs: [], at: 0, createdBy: 'Demo setup' };
      else for (const [id, title] of [['copy', 'Onboarding copy review'], ['access', 'Keyboard accessibility audit']]) state['task:' + id] = { id, title, owner: '', status: 'To do', at: 0, createdBy: 'Demo setup' };
      applyOperation(roomId, { type: 'put', object: widget }, 'Demo setup');
    }
    if (!getRoom(roomId).objects.some(o => o.id === noteId)) {
      const note = makeObject('note', 'Demo setup', { x: 840, y: 160 }, { text: 'Working decision' }); note.id = noteId;
      applyOperation(roomId, { type: 'put', object: note }, 'Demo setup');
    }
    if (step === 0 && fixture.capability === 'kanban') {
      const state = getRoom(roomId).objects.find(o => o.id === widgetId)!.data.state as Record<string, object>;
      applyOperation(roomId, { type: 'patch', id: widgetId, patch: { data: { state: { 'task:copy': { ...state['task:copy'], status: 'To do' }, 'task:access': { ...state['task:access'], status: 'To do' } } } } }, 'Demo setup');
    }
    const id = input.target === 'widget' ? widgetId : noteId;
    const selected = getCanvasRecords(roomId).find(r => r.id === 'shape:' + id) as TLShape;
    const widget = input.target === 'widget' ? getRoom(roomId).objects.find(o => o.id === id) : undefined;
    const context = { request: input.prompt, pageId: String(selected.parentId), shapes: [selected], widget };
    const plan = await decideReactive(context, engine, undefined, fixture.capability === 'debate' && input.target === 'widget' ? 'contribution' : undefined);
    let correct = plan.route === input.expected;
    const contribution = plan.widget?.state.contribution as { links: Array<{ claimId: string; relation: string }> } | undefined;
    if ('relation' in input) correct &&= contribution?.links.length === 1 && contribution.links.some(l => l.claimId === input.claim && l.relation === input.relation);
    if ('task' in input) correct &&= (plan.widget?.state['task:' + input.task] as { status: string } | undefined)?.status === input.status;
    const command = plan.batch?.commands[0];
    if (command?.type === 'update_shape') {
      if ('color' in input) correct &&= 'color' in command.patch.props && command.patch.props.color === input.color;
      if ('text' in input) correct &&= 'text' in command.patch.props && command.patch.props.text === input.text;
      if ('dx' in input) correct &&= command.x === selected.x + input.dx!;
      if ('dy' in input) correct &&= command.y === selected.y + input.dy!;
    }
    const applied = correct && plan.route !== 'defer' ? applyReactive(roomId, plan, context, input.actor) : undefined;
    const updated = getRoom(roomId).objects.find(o => o.id === id);
    json(res, 200, { engine, story, step, route: plan.route, modelMs: plan.modelMs, confidence: plan.confidence, correct, committed: !!applied, roomId, objectId: applied?.objectId, requestId: applied?.requestId, expected: input.expected, plan, observed: updated, serverMs: Math.round(performance.now() - started) });
  } catch (error) { json(res, 502, { engine, error: error instanceof Error ? error.message : 'Benchmark failed' }); }
  finally { active.delete(engine); }
  return true;
}
