import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { json } from './http';
import { AgentError } from './agents/contract';
import { mcpApps, type McpApps } from './mcp/apps';
import { mcpSessionSchema } from '../shared/mcp-app';
export { handleMcpSandbox } from './mcp/sandbox';

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, apps: McpApps = mcpApps): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/mcp/')) return false;
  try {
    if (req.method === 'GET' && url.pathname === '/api/mcp/profiles') { json(res, 200, { profiles: apps.profiles() }); return true; }
    if (req.method !== 'POST') throw new AgentError('Use POST for MCP App actions.', 405);
    const parts: Buffer[] = []; let size = 0;
    for await (const part of req) { const bytes = Buffer.from(part); size += bytes.length; if (size > 32000) throw new AgentError('This app request is too large.', 413); parts.push(bytes); }
    let raw: unknown; try { raw = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new AgentError('Invalid app request.', 400); }
    let result: unknown;
    if (url.pathname === '/api/mcp/create') result = await apps.create(raw);
    else if (url.pathname === '/api/mcp/open') result = await apps.open(raw, `http://${req.headers.host}`);
    else if (url.pathname === '/api/mcp/run') result = await apps.call(raw, false);
    else if (url.pathname === '/api/mcp/call') result = await apps.call(raw, true);
    else if (url.pathname === '/api/mcp/context') result = apps.context(raw);
    else if (url.pathname === '/api/mcp/resource') {
      const { uri, ...input } = mcpSessionSchema.extend({ uri: z.string() }).strict().parse(raw), resource = await apps.resource(input, uri);
      result = { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: resource.html, _meta: { ui: { csp: resource.csp, permissions: {} } } }] };
    } else throw new AgentError('Unknown MCP App action.', 404);
    json(res, 200, result);
  } catch (error) { json(res, error instanceof AgentError ? error.status : error instanceof z.ZodError ? 400 : 500, { error: error instanceof AgentError ? error.message : 'The MCP App request could not be completed.' }); }
  return true;
}
