import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { transcriptEntrySchema } from '../shared/transcript';
import { AgentError, agentModels } from './agents/contract';
import { codexAvailability } from './agents/codex';
import { contribute } from './agents/contribute';
import { fulfillRoomRequest } from './agents/fulfill-request';
import { appendTranscript } from './agents/transcript';
import { createVoiceSession } from './agents/voice-session';
import { executeVoiceTool } from './agents/voice-tools';
import { voiceOwnership } from './agents/voice-ownership';
import { RoomError } from './room-store';

const requests = new Set<AbortController>();
const voiceTranscriptRequestSchema = z.object({ roomId: z.string(), sessionId: z.string(), actor: z.string(), arguments: transcriptEntrySchema.omit({ at: true, source: true }) });
export function cancelAgentRequests() { for (const request of requests) request.abort(); }

function reply(res: ServerResponse, status: number, body: unknown) {
  if (res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage, limit = 80000): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const data = Buffer.from(chunk); size += data.length; if (size > limit) throw new AgentError('Request is too large.', 413); chunks.push(data); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function handleAgentRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!['/api/agents', '/api/agents/generate', '/api/agents/contribute', '/api/voice/session', '/api/voice/tool', '/api/voice/transcript', '/api/voice/heartbeat', '/api/voice/stop'].includes(url.pathname)) return false;
  const controller = new AbortController();
  requests.add(controller);
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', disconnect);
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new AgentError('Open this room directly to use its agents.', 403);
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      const availability = await codexAvailability();
      reply(res, 200, { providers: [...availability.providers, { id: 'cerebras', name: 'Qwen 3.8 · Cerebras', model: agentModels.cerebras, configured: !!process.env.CEREBRAS_API_KEY, reasoning: ['none', 'low', 'medium', 'high'], fast: false, reason: process.env.CEREBRAS_API_KEY ? undefined : 'Cerebras API key not configured.' }], voice: { configured: !!process.env.OPENAI_API_KEY, name: 'GPT-Live', model: 'gpt-live-1' } });
    } else {
      if (req.method !== 'POST' || url.pathname === '/api/agents') throw new AgentError('Use the supported request method.', 405);
      const raw = await body(req, ['/api/voice/tool', '/api/agents/generate'].includes(url.pathname) ? 1600000 : 80000);
      if (url.pathname === '/api/voice/session') {
        const roomId = url.searchParams.get('roomId') ?? '';
        const sessionId = url.searchParams.get('sessionId') ?? '';
        const actor = url.searchParams.get('actor') ?? '';
        voiceOwnership.begin(roomId, actor, sessionId);
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const answer = await createVoiceSession(raw, url, controller.signal);
          if (controller.signal.aborted || res.destroyed) { voiceOwnership.stop(roomId, sessionId); return true; }
          voiceOwnership.activate(roomId, sessionId);
          res.writeHead(200, { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' }); res.end(answer);
        } catch (error) { voiceOwnership.stop(roomId, sessionId); throw error; }
        finally { clearTimeout(timeout); }
      } else {
        let input: unknown; try { input = JSON.parse(raw); } catch { throw new AgentError('Invalid JSON request.', 400); }
        if (url.pathname === '/api/voice/heartbeat' || url.pathname === '/api/voice/stop') {
          if (!input || typeof input !== 'object' || !('roomId' in input) || !('sessionId' in input) || typeof input.roomId !== 'string' || typeof input.sessionId !== 'string') throw new AgentError('Invalid voice session.', 400);
          if (url.pathname === '/api/voice/heartbeat') voiceOwnership.heartbeat(input.roomId, input.sessionId);
          else voiceOwnership.stop(input.roomId, input.sessionId);
          reply(res, 200, { ok: true });
        } else if (url.pathname === '/api/voice/transcript') {
          const result = voiceTranscriptRequestSchema.safeParse(input);
          if (!result.success) throw new AgentError('Invalid final transcript.', 400);
          const parsed = result.data;
          reply(res, 200, await voiceOwnership.runTool({ ...parsed, name: 'save_transcript', callId: `caption_${createHash('sha256').update(parsed.arguments.id).digest('hex')}` }, async () => appendTranscript(parsed.roomId, parsed.actor, parsed.sessionId, parsed.arguments)));
        } else reply(res, 200, await (url.pathname === '/api/agents/contribute' ? contribute(input, controller.signal) : url.pathname === '/api/agents/generate' ? fulfillRoomRequest(input, controller.signal) : voiceOwnership.runTool(input, () => executeVoiceTool(input, controller.signal))));
      }
    }
  } catch (error) {
    if (error instanceof AgentError || error instanceof RoomError) reply(res, error.status, { error: error.message });
    else reply(res, 502, { error: controller.signal.aborted ? 'The request was cancelled or timed out.' : 'The agent could not complete this request. Please try again.' });
  } finally { res.off('close', disconnect); requests.delete(controller); }
  return true;
}
