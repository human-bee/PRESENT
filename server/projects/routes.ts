import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http';
import { ProjectRegistry, ProjectRegistryError } from './registry';

/** Coordinator wiring: call this before generic API fallthrough in server/index.ts. */
export async function handleProjectRequest(req: IncomingMessage, res: ServerResponse, registry = new ProjectRegistry()): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/api/projects') return false;
  if (req.method !== 'GET') { json(res, 405, { error: 'Use GET for projects.' }); return true; }
  try { json(res, 200, { projects: registry.list() }); }
  catch (error) { json(res, error instanceof ProjectRegistryError ? 503 : 500, { error: 'Projects are unavailable.' }); }
  return true;
}
