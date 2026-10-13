import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http';
import { ProjectRegistry, ProjectRegistryError } from './registry';
import { ProjectChanges } from './apply';
import { AgentError } from '../agents/contract';
import { AccessError } from '../access/store';
import { ZodError } from 'zod';

/** The invite dispatcher supplies current signed room identity before these handlers. */
export async function handleProjectRequest(req: IncomingMessage, res: ServerResponse, registry = new ProjectRegistry(), changes = new ProjectChanges({ registry })): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!['/api/projects', '/api/projects/review', '/api/projects/apply'].includes(url.pathname)) return false;
  try {
    if (url.pathname === '/api/projects') {
      if (req.method !== 'GET') { json(res, 405, { error: 'Use GET for projects.' }); return true; }
      json(res, 200, { projects: registry.list() });
    } else {
      if (req.method !== 'POST') { json(res, 405, { error: 'Use POST for project review and apply.' }); return true; }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new AgentError('JSON required.', 415);
      const parts: Buffer[] = []; let size = 0;
      for await (const part of req) { const bytes = Buffer.from(part); size += bytes.length; if (size > 4096) throw new AgentError('Project approval is too large.', 413); parts.push(bytes); }
      let input: unknown; try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new AgentError('Invalid JSON.', 400); }
      const review = url.pathname.endsWith('/apply') ? changes.apply(input) : changes.review(input);
      json(res, 200, { review });
    }
  } catch (error) {
    json(res, error instanceof AccessError || error instanceof AgentError ? error.status : error instanceof ZodError ? 400 : error instanceof ProjectRegistryError ? 409 : 500,
      { error: error instanceof AccessError || error instanceof AgentError || error instanceof ProjectRegistryError ? error.message : 'Project changes could not be verified.' });
  }
  return true;
}
