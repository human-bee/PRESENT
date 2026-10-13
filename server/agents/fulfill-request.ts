import { agentNames } from '../../shared/agent-models';
import { randomUUID } from 'node:crypto';
import { AgentError, generationRequestSchema } from './contract';
import { requestJournal } from './request-journal';
import { runRoomRequest } from './room-request';
import { researchRoom } from './research';
import { generateRoomImage } from './image-generation';
import { requireRoomAuthorization } from '../access/context';
import { AccessError } from '../access/store';

export async function fulfillRoomRequest(raw: unknown, signal?: AbortSignal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AgentError('A valid request and room are required.', 400);
  const { recoverOnly, ...request } = raw as Record<string, unknown>;
  if (recoverOnly !== undefined && typeof recoverOnly !== 'boolean') throw new AgentError('Invalid recovery mode.', 400);
  const parsed = generationRequestSchema.safeParse(request);
  if (!parsed.success) throw new AgentError('A valid request and room are required.', 400);
  if (recoverOnly && !parsed.data.requestId) throw new AgentError('Recovery requires the saved request identity.', 400);
  const input = { ...request, ...parsed.data, requestId: parsed.data.requestId ?? randomUUID() };
  const check = () => {
    const grant = requireRoomAuthorization(input.roomId, 'tools');
    if (grant && grant.userId !== input.actor) throw new AccessError('This request belongs to another participant.');
  };
  check();
  const result = recoverOnly ? requestJournal.recover(input, input) : await requestJournal.run(input, input, () => executeRequest(input, signal));
  check();
  return result;
}

async function executeRequest(raw: unknown, signal?: AbortSignal) {
  const started = performance.now();
  const planned = await runRoomRequest(raw, signal);
  if (planned.delegatedRequest) {
    const result = planned.kind === 'research' ? await researchRoom(planned.delegatedRequest, signal) : await generateRoomImage(planned.delegatedRequest, signal);
    return { ...result, kind: planned.kind, provider: planned.provider,
      providerName: planned.kind === 'research' ? 'Research' : 'Image generation', elapsedMs: Math.round(performance.now() - started) };
  }
  return { ...planned, providerName: ('providerName' in planned && planned.providerName) || ('decision' in planned && planned.decision && planned.decision.route !== 'defer' ? 'Jev' : agentNames[planned.provider]) };
}
