import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { AgentError } from '../agents/contract';
import { mcpAppSchema, type McpProfileSummary } from '../../shared/mcp-app';

const origin = z.string().max(300).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password; } catch { return false; }
}, 'Use an exact HTTPS origin.');
export const mcpProfileSchema = z.object({
  id: mcpAppSchema.shape.serverProfile, title: z.string().min(1).max(100),
  url: z.string().url().max(2048).refine(value => { const url = new URL(value); return !url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))); }),
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), z.string().max(8000)).default({}),
  tools: z.array(mcpAppSchema.shape.toolName).min(1).max(30),
  cspOrigins: z.array(origin).max(30).default([]),
}).strict();
export type McpProfile = z.infer<typeof mcpProfileSchema>;
export function readMcpProfiles(path = process.env.PRESENT_MCP_PROFILES_FILE): McpProfile[] {
  if (!path) return [];
  try {
    if (!isAbsolute(path) || statSync(path).size > 128000) throw new Error('Invalid profile file');
    const profiles = z.object({ profiles: z.array(mcpProfileSchema).max(20) }).strict().parse(JSON.parse(readFileSync(path, 'utf8'))).profiles;
    if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('Repeated profile');
    return profiles;
  } catch { throw new AgentError('MCP profiles are unavailable. Check the server-owned profile file.', 503); }
}
export const summarizeMcpProfiles = (profiles: McpProfile[]): McpProfileSummary[] => profiles.map(({ id, title, tools }) => ({ id, title, tools }));
