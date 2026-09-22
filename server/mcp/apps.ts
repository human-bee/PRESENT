import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { RESOURCE_MIME_TYPE, McpUiResourceMetaSchema, McpUiUpdateModelContextRequestSchema } from '@modelcontextprotocol/ext-apps/app-bridge';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mcpAppSchema, mcpCreateSchema, mcpIdentitySchema, mcpInputSchema, mcpSessionSchema, type McpAppReference } from '../../shared/mcp-app';
import { makeObject } from '../../shared/room';
import { applyOperation, getRoom } from '../room-store';
import { AgentError } from '../agents/contract';
import { readMcpProfiles, summarizeMcpProfiles, type McpProfile } from './profiles';
import { boundedMcpValue, mcpTool, toolResource, withMcpClient } from './client';
import { createSandboxGrant, restrictMcpCsp } from './sandbox';

const identity = mcpIdentitySchema.strict();
const invokeSchema = mcpSessionSchema.extend({ requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: mcpAppSchema.shape.toolName.optional(), arguments: mcpInputSchema.optional() }).strict();
type Context = { roomId: string; objectId: string; updatedAt: number; contentTrust: 'untrusted-mcp-app'; context: unknown };
type Dependencies = { profiles: () => McpProfile[]; getRoom: typeof getRoom; applyOperation: typeof applyOperation; audit: (event: Record<string, unknown>) => void };
export class McpApps {
  private sessions = new Map<string, { identity: string; fingerprint: string; expiresAt: number }>();
  private results = new Map<string, { ref: string; result: CallToolResult }>();
  private calls = new Map<string, { digest: string; promise: Promise<CallToolResult> }>();
  private contexts = new Map<string, Context & { reference: string }>();
  constructor(private dependencies: Dependencies = { profiles: readMcpProfiles, getRoom, applyOperation, audit: event => console.info(JSON.stringify({ service: 'mcp-app', ...event })) }) {}
  profiles() { return summarizeMcpProfiles(this.dependencies.profiles()); }
  private profile(id: string) {
    const profile = this.dependencies.profiles().find(item => item.id === id);
    if (!profile) throw new AgentError('This MCP server profile is not configured.', 403);
    return profile;
  }
  private reference(raw: unknown) {
    const input = identity.parse(raw), object = this.dependencies.getRoom(input.roomId).objects.find(item => item.id === input.objectId);
    if (!object) throw new AgentError('This MCP App no longer exists in the room.', 404);
    const ref = mcpAppSchema.safeParse(object.data);
    if (!ref.success) throw new AgentError('This object is not a valid MCP App reference.', 400);
    return { input, ref: ref.data, profile: this.profile(ref.data.serverProfile) };
  }
  private key(roomId: string, objectId: string) { return `${roomId}:${objectId}`; }
  private fingerprint(ref: McpAppReference, profile: McpProfile) { return createHash('sha256').update(JSON.stringify({ ref, profile })).digest('hex'); }
  private session(raw: unknown) {
    const { appSession, ...input } = mcpSessionSchema.parse(raw), state = this.reference(input), session = this.sessions.get(appSession);
    if (!session || session.expiresAt < Date.now() || session.identity !== JSON.stringify(input) || session.fingerprint !== this.fingerprint(state.ref, state.profile)) throw new AgentError('This app session no longer matches the room. Reconnect the app before running tools.', 409);
    return state;
  }
  async create(raw: unknown) {
    const input = mcpCreateSchema.parse(raw), profile = this.profile(input.serverProfile);
    this.dependencies.getRoom(input.roomId);
    return withMcpClient(profile, async (_client, tools) => {
      const tool = mcpTool(tools, profile, input.toolName);
      const data: McpAppReference = mcpAppSchema.parse({ capability: 'mcp-app', version: 1, serverProfile: profile.id, toolName: tool.name, resourceUri: toolResource(tool), toolInput: input.toolInput });
      const object = makeObject('widget', input.actor, input.position, data); object.title = `${profile.title} · ${tool.title ?? tool.name}`.slice(0, 200); object.w = 520; object.h = 440;
      this.dependencies.applyOperation(input.roomId, { type: 'put', object, ...(input.pageId ? { pageId: input.pageId } : {}) }, input.actor);
      this.dependencies.audit({ action: 'create', roomId: input.roomId, actor: input.actor, objectId: object.id, profile: profile.id, tool: tool.name, resourceUri: data.resourceUri });
      return { objectId: object.id };
    });
  }
  async resource(raw: unknown, requestedUri?: string) {
    const { input, ref, profile } = requestedUri === undefined ? this.reference(raw) : this.session(raw);
    if (requestedUri !== undefined && requestedUri !== ref.resourceUri) throw new AgentError('This app can only read its own linked UI resource.', 403);
    return withMcpClient(profile, async (client, tools) => {
      const tool = mcpTool(tools, profile, ref.toolName);
      if (toolResource(tool) !== ref.resourceUri) throw new AgentError('The app resource does not match its configured tool.', 403);
      const resource = await client.readResource({ uri: ref.resourceUri }, { timeout: 10000 });
      if (resource.contents.length !== 1 || resource.contents[0].uri !== ref.resourceUri || resource.contents[0].mimeType !== RESOURCE_MIME_TYPE) throw new AgentError('The MCP server did not return its exact linked app resource.', 502);
      const content = resource.contents[0], html = 'text' in content ? content.text : Buffer.from(content.blob, 'base64').toString('utf8');
      if (Buffer.byteLength(html) > 1000000 || !/<!doctype\s+html[\s>]/i.test(html) || !/<html[\s>]/i.test(html)) throw new AgentError('The MCP App resource must be a bounded HTML5 document.', 502);
      const meta = McpUiResourceMetaSchema.safeParse(content._meta?.ui ?? {});
      if (!meta.success || meta.data.domain) throw new AgentError('This app requests unsupported sandbox metadata.', 502);
      const csp = restrictMcpCsp(meta.data.csp, profile.cspOrigins);
      this.dependencies.audit({ action: 'resource-read', roomId: input.roomId, actor: input.actor, objectId: input.objectId, profile: profile.id, tool: tool.name, resourceUri: ref.resourceUri, csp, permissionsGranted: [] });
      return { html, csp, tool: { name: tool.name, title: tool.title, description: tool.description, inputSchema: boundedMcpValue(tool.inputSchema, 24000) }, ref, binding: this.fingerprint(ref, profile) };
    });
  }
  async open(raw: unknown, hostOrigin: string) {
    const input = identity.parse(raw), { binding, ...resource } = await this.resource(input), previous = this.results.get(this.key(input.roomId, input.objectId));
    const current = this.reference(input);
    if (this.fingerprint(current.ref, current.profile) !== binding) throw new AgentError('This app changed while opening. Reconnect the app.', 409);
    for (const [key, session] of this.sessions) if (session.expiresAt < Date.now()) this.sessions.delete(key);
    if (this.sessions.size >= 250) this.sessions.delete(this.sessions.keys().next().value as string);
    const appSession = randomBytes(24).toString('hex');
    this.sessions.set(appSession, { identity: JSON.stringify(input), fingerprint: binding, expiresAt: Date.now() + 1800000 });
    return { ...resource, appSession, sandboxUrl: createSandboxGrant(hostOrigin, resource.csp), result: previous?.ref === JSON.stringify(resource.ref) ? previous.result : null, permissions: {} };
  }
  async call(raw: unknown, fromApp: boolean): Promise<CallToolResult> {
    const call = invokeSchema.parse(raw), { name, arguments: args, requestId, ...rawIdentity } = call;
    const { input, ref, profile } = this.session(rawIdentity), key = this.key(input.roomId, input.objectId);
    const actualName = fromApp ? name : ref.toolName, actualInput = fromApp ? args ?? {} : ref.toolInput;
    if (!actualName) throw new AgentError('The app must name an exact configured tool.', 400);
    const digest = createHash('sha256').update(JSON.stringify({ ref, name: actualName, args: actualInput, fromApp })).digest('hex'), requestKey = `${key}:${input.actor}:${requestId}`;
    const previous = this.calls.get(requestKey);
    if (previous) { if (previous.digest !== digest) throw new AgentError('This app request ID already belongs to another call.', 409); return previous.promise; }
    if (this.calls.size >= 500) this.calls.delete(this.calls.keys().next().value as string);
    const promise = withMcpClient(profile, async (client, tools) => {
      const linkedTool = mcpTool(tools, profile, ref.toolName);
      if (toolResource(linkedTool) !== ref.resourceUri) throw new AgentError('The app resource no longer matches its tool.', 403);
      mcpTool(tools, profile, actualName, fromApp);
      this.dependencies.audit({ action: 'tool-call', roomId: input.roomId, actor: input.actor, objectId: input.objectId, profile: profile.id, tool: actualName, requestId });
      const result = boundedMcpValue(CallToolResultSchema.parse(await client.callTool({ name: actualName, arguments: actualInput }, CallToolResultSchema, { timeout: 20000 })));
      // Recheck canonical identity after a slow call before caching invocation data.
      const current = this.session(rawIdentity);
      if (JSON.stringify(current.ref) !== JSON.stringify(ref)) throw new AgentError('The app changed while its tool was running. The tool may have completed.', 409);
      if (actualName === ref.toolName) { if (this.results.size >= 250) this.results.delete(this.results.keys().next().value as string); this.results.set(key, { ref: JSON.stringify(ref), result }); }
      this.dependencies.audit({ action: 'tool-result', roomId: input.roomId, actor: input.actor, objectId: input.objectId, profile: profile.id, tool: actualName, requestId, isError: result.isError === true });
      return result;
    });
    this.calls.set(requestKey, { digest, promise }); return promise;
  }
  context(raw: unknown) {
    const { context, ...rawIdentity } = mcpSessionSchema.extend({ context: z.unknown() }).strict().parse(raw), { input, ref } = this.session(rawIdentity);
    const parsed = McpUiUpdateModelContextRequestSchema.shape.params.parse(boundedMcpValue(context, 12000)), key = this.key(input.roomId, input.objectId);
    if (this.contexts.size >= 250) this.contexts.delete(this.contexts.keys().next().value as string);
    this.contexts.set(key, { roomId: input.roomId, objectId: input.objectId, updatedAt: Date.now(), contentTrust: 'untrusted-mcp-app', context: parsed, reference: JSON.stringify(ref) }); return {};
  }
  readContexts(roomId: string) {
    const objects = this.dependencies.getRoom(roomId).objects;
    return [...this.contexts.values()].flatMap(({ reference, ...item }) => {
      const parsed = mcpAppSchema.safeParse(objects.find(object => object.id === item.objectId)?.data);
      return item.roomId === roomId && item.updatedAt > Date.now() - 1800000 && parsed.success && JSON.stringify(parsed.data) === reference ? [item] : [];
    }).slice(-10);
  }
}
export const mcpApps = new McpApps();
