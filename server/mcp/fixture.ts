// Local verification fixture only. This module is never imported by app routes.
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { build } from 'vite';

export const fixtureResourceUri = 'ui://present-fixture/counter.html';
const appSource = `import {App} from '@modelcontextprotocol/ext-apps';
const app=new App({name:'PRESENT local fixture',version:'1.0.0'},{});let count=0;
const status=document.querySelector('#status'),counter=document.querySelector('#count');
function show(result){const data=result.structuredContent;if(data && typeof data.count==='number'){count=data.count;counter.textContent=String(count);status.textContent='Local fixture result received';}}
app.ontoolresult=show;app.ontoolinput=()=>{document.querySelector('#input-status').textContent='Tool input received';};
app.onhostcontextchanged=context=>{document.querySelector('#host-context').textContent='Host theme: '+(context.theme||app.getHostContext()?.theme||'unknown');};
document.querySelector('#increment').onclick=async()=>{try{show(await app.callServerTool({name:'fixture_increment',arguments:{amount:1}}));await app.updateModelContext({content:[{type:'text',text:'Local fixture count is '+count}]});document.querySelector('#context-status').textContent='Context sent';}catch(error){status.textContent=error.message;}};
document.querySelector('#read-resource').onclick=async()=>{try{const result=await app.readServerResource({uri:'${fixtureResourceUri}'});document.querySelector('#resource-status').textContent='Resource read: '+result.contents[0].uri;}catch(error){status.textContent=error.message;}};
await app.connect();document.querySelector('#host-context').textContent='Host theme: '+app.getHostContext()?.theme;status.textContent='Connected · press Run app';`;
async function fixtureHtml() {
  const built = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'present-mcp-fixture', resolveId: id => id === 'virtual:mcp-fixture' ? '\0mcp-fixture' : null, load: id => id === '\0mcp-fixture' ? appSource : null }], build: { write: false, minify: false, target: 'esnext', rollupOptions: { input: 'virtual:mcp-fixture', output: { format: 'es' } } } });
  if ('close' in built) throw new Error('Unexpected fixture bundle watcher');
  const output = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk');
  if (output?.type !== 'chunk') throw new Error('Missing fixture app bundle');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Local MCP fixture</title><style>body{font:15px system-ui;padding:24px;background:#f4f7ed;color:#28342a}button{padding:10px;margin-right:8px}#count{font-size:42px;margin:18px 0}small{display:block;margin-top:10px}</style></head><body><h2>Local MCP fixture</h2><p id="status">Connecting…</p><div id="count">0</div><button id="increment">Increment fixture</button><button id="read-resource">Read linked resource</button><small id="input-status">Waiting for input</small><small id="host-context">Waiting for host context</small><small id="context-status"></small><small id="resource-status"></small><script type="module">${output.code.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
export async function startMcpFixture() {
  const html = await fixtureHtml(), calls: string[] = [], requests: { method: string; authorized: boolean }[] = [];
  let count = 0, capabilities: unknown;
  const connections = new Set<McpServer>();
  const server = createServer(async (req, res) => {
    if (req.url !== '/mcp' || req.headers['x-fixture-secret'] !== 'local-fixture-secret') { res.writeHead(403); res.end(); return; }
    const mcp = new McpServer({ name: 'PRESENT local fixture', version: '1.0.0' }); connections.add(mcp);
    const result = () => ({ content: [{ type: 'text' as const, text: `Local fixture count: ${count}` }], structuredContent: { count, fixture: true } });
    registerAppTool(mcp, 'fixture_counter', { title: 'Local fixture counter', inputSchema: { label: z.string().optional() }, _meta: { ui: { resourceUri: fixtureResourceUri } } }, async () => { calls.push('fixture_counter'); return result(); });
    registerAppTool(mcp, 'fixture_increment', { inputSchema: { amount: z.number().int().min(1).max(10) }, _meta: { ui: { visibility: ['app'] } } }, async ({ amount }) => { calls.push('fixture_increment'); count += amount; return result(); });
    registerAppTool(mcp, 'fixture_model_only', { _meta: { ui: { visibility: ['model'] } } }, async () => { calls.push('fixture_model_only'); return result(); });
    registerAppResource(mcp, 'Local fixture view', fixtureResourceUri, {}, async () => ({ contents: [{ uri: fixtureResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { csp: {}, permissions: { camera: {} } } } }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part));
      const body = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : undefined;
      requests.push({ method: body?.method ?? req.method ?? '', authorized: true });
      if (body?.method === 'initialize') capabilities = body.params?.capabilities;
      res.on('close', () => { void mcp.close(); connections.delete(mcp); });
      await mcp.connect(transport); await transport.handleRequest(req, res, body);
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return { url: `http://127.0.0.1:${address.port}/mcp`, calls, requests, capabilities: () => capabilities, count: () => count, close: async () => { await Promise.all([...connections].map(connection => connection.close())); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
