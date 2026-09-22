import { makeObject, type RoomState } from '../../shared/room';
import { applyOperation, getCanvasRecords, getRoom } from '../room-store';
import { requireCanvasPage } from '../tldraw-operations';
import { AgentError, agentModels, generationPrompt, generationRequestSchema, parseWidget, type GeneratedWidget, type GenerationRequest } from './contract';
import { generateWithCerebras } from './cerebras';
import { generateWithCodex } from './codex';

type Store = { getRoom: typeof getRoom; applyOperation: typeof applyOperation; getCanvasRecords?: typeof getCanvasRecords };
type Generators = { codex: typeof generateWithCodex; cerebras: typeof generateWithCerebras };
const roomsInFlight = new Set<string>();
let active = 0;

export function applyGeneratedWidget(input: GenerationRequest, output: GeneratedWidget, before: RoomState, elapsedMs: number, store: Store = { getRoom, applyOperation }): string {
  const provenance = { provider: input.provider, model: agentModels[input.provider], reasoning: input.reasoning ?? 'low', fast: input.fast ?? false, generatedAt: Date.now(), elapsedMs };
  if (output.intent === 'edit') {
    const prior = before.objects.find(o => o.id === output.targetId && o.kind === 'widget');
    if (!prior || !input.selection.includes(prior.id)) throw new AgentError('Select the widget you want to change and try again.', 409);
    const current = store.getRoom(input.roomId).objects.find(o => o.id === prior.id);
    if (!current || current.data.html !== prior.data.html) throw new AgentError('This widget changed while the agent was working. Try again with the latest version.', 409);
    const patch = { ...(current.title === prior.title ? { title: output.title } : {}), ...(current.w === prior.w ? { w: output.width } : {}), ...(current.h === prior.h ? { h: output.height } : {}), data: { html: output.html, ...provenance } };
    store.applyOperation(input.roomId, { type: 'patch', id: prior.id, patch }, `agent:${input.provider}`);
    return prior.id;
  }
  const object = makeObject('widget', `agent:${input.provider}`, input.position, { html: output.html, state: {}, ...provenance });
  Object.assign(object, { title: output.title, w: output.width, h: output.height });
  store.applyOperation(input.roomId, { type: 'put', object, ...(input.pageId ? { pageId: input.pageId } : {}) }, `agent:${input.provider}`);
  return object.id;
}

export async function generateWidget(raw: unknown, signal?: AbortSignal, dependencies: Store & Generators = { getRoom, applyOperation, codex: generateWithCodex, cerebras: generateWithCerebras }) {
  const parsed = generationRequestSchema.safeParse(raw);
  if (!parsed.success) throw new AgentError('A room, prompt, provider and canvas position are required.', 400);
  const input = parsed.data;
  if (input.pageId) requireCanvasPage((dependencies.getCanvasRecords ?? getCanvasRecords)(input.roomId), input.pageId);
  if (active >= 2 || roomsInFlight.has(input.roomId)) throw new AgentError('An agent is already making something. Try again when it finishes.', 429);
  const before = dependencies.getRoom(input.roomId);
  if (input.selection.some(id => !before.objects.some(o => o.id === id))) throw new AgentError('Your selection changed. Select the current object and try again.', 409);
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, input.provider === 'codex' ? 180000 : 60000);
  active++; roomsInFlight.add(input.roomId);
  const started = performance.now();
  try {
    if (signal?.aborted) controller.abort();
    const prompt = generationPrompt(input, before);
    const output = parseWidget(await (input.provider === 'cerebras' ? dependencies.cerebras(prompt, controller.signal, undefined, input) : dependencies.codex(prompt, controller.signal, input.provider, undefined, input)));
    if (controller.signal.aborted) throw new AgentError('Widget generation timed out. Your room is unchanged.', 504);
    const elapsedMs = Math.round(performance.now() - started);
    const objectId = applyGeneratedWidget(input, output, before, elapsedMs, dependencies);
    return { objectId, elapsedMs, provider: input.provider };
  } catch (error) {
    if (controller.signal.aborted) throw new AgentError('Widget generation timed out or was cancelled. Your room is unchanged.', 504);
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); active--; roomsInFlight.delete(input.roomId); }
}
