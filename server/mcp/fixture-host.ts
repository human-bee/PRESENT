// Explicit local browser-proof harness. It does not load production profiles.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { RoomStore } from '../room-store';
import { commonHeaders, isLocalRequest, json } from '../http';
import { handleMcpRequest, handleMcpSandbox } from '../mcp-routes';
import { McpApps } from './apps';
import { mcpProfileSchema } from './profiles';
import { startMcpFixture } from './fixture';

async function hostBundle() {
  const widget = fileURLToPath(new URL('../../src/widgets/mcp-app.tsx', import.meta.url));
  const source = `import React from 'react';import{createRoot}from'react-dom/client';import{McpApp}from ${JSON.stringify(widget)};const state=await(await fetch('/fixture/state')).json();createRoot(document.getElementById('app')).render(React.createElement(McpApp,{roomId:state.roomId,object:state.object,selfId:state.actor}));`;
  const built = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'present-mcp-proof', resolveId: id => id === 'virtual:mcp-proof' ? '\0mcp-proof' : null, load: id => id === '\0mcp-proof' ? source : null }], build: { write: false, minify: false, target: 'esnext', rollupOptions: { input: 'virtual:mcp-proof', output: { format: 'es' } } } });
  if ('close' in built) throw new Error('Unexpected fixture watcher');
  const output = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk');
  if (output?.type !== 'chunk') throw new Error('Missing fixture host bundle');
  return output.code;
}
export async function startMcpFixtureHost() {
  const fixture = await startMcpFixture(), directory = mkdtempSync(join(tmpdir(), 'present-mcp-browser-'));
  const store = new RoomStore({ directory, legacyDirectory: join(directory, 'legacy') }), audits: Record<string, unknown>[] = [];
  const profile = mcpProfileSchema.parse({ id: 'local-fixture', title: 'Local fixture', url: fixture.url, headers: { 'X-Fixture-Secret': 'local-fixture-secret' }, tools: ['fixture_counter', 'fixture_increment'] });
  const apps = new McpApps({ profiles: () => [profile], getRoom: store.getRoom.bind(store), applyOperation: store.applyOperation.bind(store), audit: event => audits.push(event) });
  const roomId = 'c'.repeat(32), actor = 'fixture-human', { objectId } = await apps.create({ roomId, actor, serverProfile: profile.id, toolName: 'fixture_counter', toolInput: { label: 'Browser fixture' } });
  const code = await hostBundle(); let port = 0;
  const server = createServer(async (req, res) => {
    commonHeaders(res);
    const hostOrigin = `http://127.0.0.1:${port}`, sandboxOrigin = `http://localhost:${port}`;
    if (handleMcpSandbox(req, res, { hostOrigin, sandboxOrigin })) return;
    if (req.headers.host !== `127.0.0.1:${port}` || !isLocalRequest(req, port)) return json(res, 403, { error: 'Only the fixture host may use these routes.' });
    res.setHeader('content-security-policy', `frame-src ${sandboxOrigin}; object-src 'none'; base-uri 'self'`);
    if (await handleMcpRequest(req, res, apps)) return;
    if (req.url === '/fixture/state') return json(res, 200, { roomId, actor, object: store.getRoom(roomId).objects.find(object => object.id === objectId) });
    if (req.url === '/fixture/audit') return json(res, 200, { fixtureOnly: true, count: fixture.count(), calls: fixture.calls, contexts: apps.readContexts(roomId), audits });
    if (req.url === '/fixture.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(code); return; }
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><head><meta charset="utf-8"><title>PRESENT local MCP fixture proof</title><style>body{font:15px system-ui;background:#e8eddf;margin:0;padding:30px}h1{font-size:20px}#app{height:620px;width:820px;max-width:100%;background:white;border:1px solid #cad2c0;border-radius:12px;overflow:hidden}button{border:0;border-radius:6px;padding:9px;background:#deebc8;color:#28342a;cursor:pointer}</style></head><body><h1>PRESENT · Local MCP fixture proof</h1><p>This isolated fixture uses the official MCP server, client, App and AppBridge SDKs.</p><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
    json(res, 404, { error: 'Fixture route not found.' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture host address'); port = address.port;
  return { url: `http://127.0.0.1:${port}`, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fixture.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = await startMcpFixtureHost(); console.info(`Local MCP fixture host: ${host.url}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void host.close().then(() => process.exit(0)); });
}
