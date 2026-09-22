import { z } from 'zod';
import type { TLShape } from '@tldraw/tlschema';
import { getRoom, getCanvasRecords } from '../room-store';
import { AgentError } from './contract';
import { decideReactive } from './reactive-decisions';
import { applyReactive } from './apply-reactive';
const schema = z.object({ roomId: z.string().regex(/^[a-f0-9]{24,64}$/), objectId: z.string().min(1).max(100), actor: z.string().min(1).max(100), text: z.string().trim().min(1).max(1200), requestId: z.string().regex(/^[\w:.-]{1,100}$/) }).strict();
const pending = new Set<string>();
/** Explicit contribution form supplies intent; Jev only judges its relationships. */
export async function contribute(raw: unknown, signal?: AbortSignal) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AgentError('Choose a debate and write one contribution.', 400);
  const input = parsed.data, started = performance.now(), key = input.roomId + ':' + input.objectId + ':' + input.requestId;
  const widget = getRoom(input.roomId).objects.find(o => o.id === input.objectId && o.data.capability === 'debate');
  if (!widget) throw new AgentError('That debate desk no longer exists.', 404);
  const state = (widget.data.state ?? {}) as Record<string, unknown>;
  const saved = state['contribution:' + input.requestId] as { text?: string; createdBy?: string } | undefined;
  if (saved) {
    if (saved.text !== input.text || saved.createdBy !== input.actor) throw new AgentError('This request ID was already used.', 409);
    return { objectId: widget.id, requestId: input.requestId, alreadySaved: true };
  }
  if (pending.has(key) || pending.size >= 4) throw new AgentError('Contributions are being connected. Try again shortly.', 429);
  pending.add(key);
  try {
    const shape = getCanvasRecords(input.roomId).find(r => r.typeName === 'shape' && r.id === 'shape:' + input.objectId) as TLShape | undefined;
    if (!shape || !shape.parentId.startsWith('page:')) throw new AgentError('Select a debate on this page.', 409);
    const context = { request: input.text, pageId: String(shape.parentId), shapes: [shape], widget };
    const budget = AbortSignal.timeout(800);
    const plan = await decideReactive(context, 'jev', signal ? AbortSignal.any([signal, budget]) : budget, 'contribution');
    if (signal?.aborted) throw new AgentError('Contribution cancelled.', 408);
    return { ...applyReactive(input.roomId, plan, context, input.actor, input.requestId), modelMs: plan.modelMs, elapsedMs: Math.round(performance.now() - started) };
  } finally { pending.delete(key); }
}
