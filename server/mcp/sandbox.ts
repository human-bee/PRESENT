import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpUiResourceCspSchema, type McpUiResourceCsp } from '@modelcontextprotocol/ext-apps/app-bridge';
import { AgentError } from '../agents/contract';

type SandboxGrant = { hostOrigin: string; sandboxOrigin: string; policy: string; expiresAt: number };
const grants = new Map<string, SandboxGrant>();
export function restrictMcpCsp(raw: unknown, allowedOrigins: string[]): McpUiResourceCsp {
  const parsed = McpUiResourceCspSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new AgentError('The app declared invalid sandbox policy.', 502);
  const allowed = new Set(allowedOrigins);
  const select = (values?: string[]) => [...new Set(values ?? [])].filter(value => allowed.has(value));
  return { connectDomains: select(parsed.data.connectDomains), resourceDomains: select(parsed.data.resourceDomains), frameDomains: select(parsed.data.frameDomains), baseUriDomains: select(parsed.data.baseUriDomains) };
}
export function mcpSandboxPolicy(csp: McpUiResourceCsp, hostOrigin: string): string {
  const sources = (values?: string[]) => values?.length ? values.join(' ') : "'none'";
  return `default-src 'none'; script-src 'unsafe-inline' ${csp.resourceDomains?.join(' ') ?? ''}; style-src 'unsafe-inline' ${csp.resourceDomains?.join(' ') ?? ''}; img-src data: blob: ${csp.resourceDomains?.join(' ') ?? ''}; media-src data: blob: ${csp.resourceDomains?.join(' ') ?? ''}; font-src data: ${csp.resourceDomains?.join(' ') ?? ''}; connect-src ${sources(csp.connectDomains)}; frame-src 'self' ${csp.frameDomains?.join(' ') ?? ''}; base-uri ${sources(csp.baseUriDomains)}; form-action 'none'; object-src 'none'; frame-ancestors ${hostOrigin}`;
}
export function createSandboxGrant(hostOrigin: string, csp: McpUiResourceCsp): string {
  const host = new URL(hostOrigin);
  if (host.protocol !== 'http:' || host.hostname !== '127.0.0.1' || !host.port || host.origin !== hostOrigin) throw new AgentError('Open this local room at its 127.0.0.1 address to use MCP Apps.', 409);
  for (const [token, grant] of grants) if (grant.expiresAt < Date.now()) grants.delete(token);
  if (grants.size >= 250) grants.delete(grants.keys().next().value as string);
  const sandboxOrigin = `http://localhost:${host.port}`, token = randomBytes(24).toString('hex');
  grants.set(token, { hostOrigin, sandboxOrigin, policy: mcpSandboxPolicy(csp, hostOrigin), expiresAt: Date.now() + 600000 });
  return `${sandboxOrigin}/mcp/sandbox/${token}`;
}

// The proxy is trusted host code. The inner view has an opaque origin and cannot
// access this proxy's storage or remove its inherited HTTP CSP.
export function sandboxDocument(hostOrigin: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>PRESENT app sandbox</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block;overflow:hidden}</style></head><body><script>
const hostOrigin=${JSON.stringify(hostOrigin)}, resourceReady='ui/notifications/sandbox-resource-ready';
if(window.parent===window || location.origin===hostOrigin)throw Error('App sandbox needs a separate host origin');
const inner=document.createElement('iframe');inner.title='MCP App view';inner.setAttribute('sandbox','allow-scripts');inner.referrerPolicy='no-referrer';document.body.appendChild(inner);
let loaded=false;
window.addEventListener('message',event=>{
 const message=event.data;if(!message || typeof message!=='object' || message.jsonrpc!=='2.0')return;
 if(event.source===window.parent && event.origin===hostOrigin){
  if(message.method===resourceReady){if(loaded || typeof message.params?.html!=='string')return;loaded=true;inner.srcdoc=message.params.html;}
  else if(loaded && !String(message.method??'').startsWith('ui/notifications/sandbox-'))inner.contentWindow.postMessage(message,'*');
 }else if(loaded && event.source===inner.contentWindow && event.origin==='null' && !String(message.method??'').startsWith('ui/notifications/sandbox-'))window.parent.postMessage(message,hostOrigin);
});
window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}},hostOrigin);
</script></body></html>`;
}
export function handleMcpSandbox(req: IncomingMessage, res: ServerResponse, options: { hostOrigin: string; sandboxOrigin: string }): boolean {
  const path = (req.url ?? '').split('?')[0];
  if (!path.startsWith('/mcp/sandbox/')) return false;
  const token = /^\/mcp\/sandbox\/([a-f0-9]{48})$/.exec(path)?.[1], grant = token ? grants.get(token) : undefined;
  const expectedHost = new URL(options.sandboxOrigin).host;
  const allowed = req.method === 'GET' && req.headers.host === expectedHost && grant && grant.expiresAt > Date.now() && grant.hostOrigin === options.hostOrigin && grant.sandboxOrigin === options.sandboxOrigin;
  if (!allowed) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Unavailable app sandbox.'); return true; }
  res.removeHeader('x-frame-options');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': grant.policy, 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), clipboard-write=(), display-capture=()' });
  res.end(sandboxDocument(grant.hostOrigin)); return true;
}
