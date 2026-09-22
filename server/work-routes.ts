import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { json } from './http';
import { AgentError } from './agents/contract';
import { startWork, getWork, cancelWork, resumeWork } from './agents/work-jobs';

const identity = z.object({ roomId: z.string().regex(/^[a-f0-9]{24,64}$/), jobId: z.string().regex(/^[a-f0-9]{32}$/), actor: z.string().min(1).max(100) });
export async function handleWorkRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/work/')) return false;
  try {
    const jobId = /^\/api\/work\/([a-f0-9]{32})$/.exec(url.pathname)?.[1];
    if (jobId && req.method === 'GET') {
      const input = identity.omit({ actor: true }).parse({ roomId: url.searchParams.get('roomId'), jobId });
      json(res, 200, getWork(input.roomId, input.jobId)); return true;
    }
    if (req.method !== 'POST') throw new AgentError('Use POST for work actions.', 405);
    const parts: Buffer[] = []; let size = 0;
    for await (const part of req) {
      const bytes = Buffer.from(part); size += bytes.length;
      if (size > 16000) throw new AgentError('This work request is too large.', 413);
      parts.push(bytes);
    }
    let raw: unknown; try { raw = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new AgentError('Invalid work request.', 400); }
    if (url.pathname === '/api/work/start') json(res, 202, startWork(raw));
    else {
      const input = identity.parse(raw);
      if (url.pathname === '/api/work/cancel') json(res, 200, cancelWork(input.roomId, input.jobId, input.actor));
      else if (url.pathname === '/api/work/resume') json(res, 202, resumeWork(input.roomId, input.jobId, input.actor));
      else throw new AgentError('Unknown work action.', 404);
    }
  } catch (error) {
    json(res, error instanceof AgentError ? error.status : error instanceof z.ZodError ? 400 : 500,
      { error: error instanceof AgentError ? error.message : 'The work request could not be completed.' });
  }
  return true;
}
