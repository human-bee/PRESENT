import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RESOURCE_MIME_TYPE, McpUiToolMetaSchema } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AgentError } from '../agents/contract';
import type { McpProfile } from './profiles';

let activeConnections = 0;
export function boundedMcpValue<T>(value: T, bytes = 256000): T {
  if (Buffer.byteLength(JSON.stringify(value)) > bytes) throw new AgentError('The MCP server returned too much data.', 502);
  return value;
}
export function mcpTool(tools: Tool[], profile: McpProfile, name: string, appRequest = false): Tool {
  if (!profile.tools.includes(name)) throw new AgentError('This app tool is not allowed by its server profile.', 403);
  const tool = tools.find(item => item.name === name);
  if (!tool) throw new AgentError('The configured MCP tool is unavailable.', 404);
  const meta = McpUiToolMetaSchema.safeParse(tool._meta?.ui ?? {});
  if (!meta.success || (appRequest && meta.data.visibility && !meta.data.visibility.includes('app'))) throw new AgentError('This MCP tool is not visible to apps.', 403);
  return tool;
}
export function toolResource(tool: Tool): string {
  const meta = McpUiToolMetaSchema.safeParse(tool._meta?.ui);
  if (!meta.success || !meta.data.resourceUri?.startsWith('ui://')) throw new AgentError('This tool does not declare an MCP App resource.', 400);
  return meta.data.resourceUri;
}
export async function withMcpClient<T>(profile: McpProfile, action: (client: Client, tools: Tool[]) => Promise<T>): Promise<T> {
  if (activeConnections >= 6) throw new AgentError('MCP Apps are busy. Try again shortly.', 429);
  activeConnections++;
  const client = new Client({ name: 'PRESENT', version: '0.1.0' }, { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [RESOURCE_MIME_TYPE] } } } });
  const transport = new StreamableHTTPClientTransport(new URL(profile.url), { requestInit: { headers: profile.headers, redirect: 'error' } });
  try {
    await client.connect(transport, { timeout: 10000 });
    const tools: Tool[] = []; let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = boundedMcpValue(await client.listTools(cursor ? { cursor } : {}, { timeout: 10000 }));
      tools.push(...result.tools); cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw new AgentError('This server exposes too many tools for the local app host.', 502);
    return await action(client, tools);
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('The configured MCP server could not complete this request.', 502);
  } finally { await client.close().catch(() => {}); activeConnections--; }
}
