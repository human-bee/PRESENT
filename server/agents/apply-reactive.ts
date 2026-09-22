import { randomUUID } from 'node:crypto';
import type { TLShape } from '@tldraw/tlschema';
import { patchNativeShape } from '../../shared/tldraw-adapter';
import { PACK_STATE_BYTES } from '../../src/widgets/packs/common';
import { debateHtml } from '../../src/widgets/packs/debate';
import { transactCanvas } from '../room-store';
import { buildCanvasMutation } from './canvas-tools';
import { AgentError } from './contract';
import type { ReactiveContext, ReactivePlan } from './reactive-decisions';

/** Compare relevant state inside the same transaction that applies the result. */
export function applyReactive(roomId: string, plan: ReactivePlan, context: ReactiveContext, actor: string, requestId: string = randomUUID(), commit = transactCanvas) {
  if (!plan.batch && !plan.widget) throw new AgentError('No reactive action was selected.', 400);
  const objectIds = context.shapes.map(s => s.id.slice(6));
  const contribution = plan.widget?.state.contribution;
  const patch = contribution ? { ['contribution:' + requestId]: { ...(contribution as object), id: requestId, at: Date.now(), createdBy: actor } } : plan.widget?.state;
  commit(roomId, { plan, ...(patch ? { patch } : {}) }, actor, records => {
    const current = context.shapes.map(before => {
      const now = records.find(r => r.id === before.id);
      if (now?.typeName !== 'shape' || now.isLocked || now.parentId !== context.pageId) throw new AgentError('The selected object changed. Select it again.', 409);
      return now;
    });
    if (plan.batch) {
      if (current.some((now, i) => JSON.stringify(now) !== JSON.stringify(context.shapes[i]))) throw new AgentError('A selected shape changed while interpreting the request. Try again.', 409);
      return buildCanvasMutation(plan.batch, records, actor, requestId).mutation;
    }
    const shape = current[0];
    if (shape.type !== 'present-widget' || shape.props.data.capability !== context.widget?.data.capability || (shape.props.data.html !== context.widget?.data.html && !(contribution && shape.props.data.html === debateHtml))) throw new AgentError('The selected widget changed. Try again.', 409);
    const state = (shape.props.data.state ?? {}) as Record<string, unknown>;
    for (const [key, previous] of Object.entries(plan.widget!.dependencies)) {
      if (JSON.stringify(state[key]) !== JSON.stringify(previous)) throw new AgentError('The referenced claim or task changed. Try again.', 409);
    }
    if (contribution && Object.keys(state).filter(k => k.startsWith('claim:') && state[k]).length !== Object.keys(plan.widget!.dependencies).length) throw new AgentError('The debate gained a claim. Try again with its current context.', 409);
    if (Buffer.byteLength(JSON.stringify({ ...state, ...patch })) > PACK_STATE_BYTES) throw new AgentError('This widget is full. Remove an old contribution before adding another.', 409);
    // Upgrade the saved debate pack while retaining every human state key.
    const data = { state: patch, ...(contribution ? { html: debateHtml } : {}) };
    const updated = patchNativeShape(shape as TLShape, { data });
    return { updates: [updated] };
  }, { requestId });
  return { objectId: objectIds[0], objectIds, requestId };
}
