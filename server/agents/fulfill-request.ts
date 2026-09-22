import { agentNames } from '../../shared/agent-models';
import { randomUUID } from 'node:crypto';
import { AgentError, generationRequestSchema } from './contract';
import { requestJournal } from './request-journal';
import { runRoomRequest } from './room-request';
import { researchRoom } from './research';
import { generateRoomImage } from './image-generation';

export async function fulfillRoomRequest(raw: unknown, signal?: AbortSignal) {
  const parsed = generationRequestSchema.safeParse(raw);
  if (!parsed.success) throw new AgentError('A valid request and room are required.', 400);
  const input = { ...raw as object, ...parsed.data, requestId: parsed.data.requestId ?? randomUUID() };
  return requestJournal.run(input, input, () => executeRequest(input, signal));
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
