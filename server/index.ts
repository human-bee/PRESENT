import { handleSceneRequest } from './scenes/routes';
import { closeScenes } from './scenes/playback';
import dotenv from 'dotenv';
import { handlePlaybook } from './playbook/routes';
import { handleReactiveBenchmark } from './reactive-benchmark';
import { handleBenchmark } from './benchmark-routes';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { closeRoomStore, RoomError, sweepExpired } from './room-store.js';
import { attachRoomSocket } from './room-socket.js';
import { commonHeaders, isLocalRequest, json, serveDist } from './http.js';
import { handleRoomRequest } from './room-routes.js';
import { handleAssetRequest } from './asset-routes.js';
import { handleEmbedRequest } from './embed-routes.js';
import { handleWorkRequest } from './work-routes.js';
import { handleActivityRequest } from './activity-routes.js';
import { activityEngine } from './activities/engine.js';
import { closeWorkJobs } from './agents/work-jobs.js';
import { handleMcpRequest, handleMcpSandbox } from './mcp-routes.js';

dotenv.config({ path: process.env.PRESENT_ENV_FILE ?? '.env.local', quiet: true });
const { handleAgentRequest, cancelAgentRequests } = await import('./agent-routes.js');
const { closeCodexSession } = await import('./agents/codex.js');
const { handleMediaRequest } = await import('./media-routes.js');
const port = Number(process.env.PRESENT_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
let closing = false;
const server = createServer(async (req, res) => {
  commonHeaders(res);
  if (closing) return json(res, 503, { error: 'The room is restarting. Reconnect in a moment.' });
  const hostOrigin = `http://127.0.0.1:${port}`, sandboxOrigin = `http://localhost:${port}`;
  if (handleMcpSandbox(req, res, { hostOrigin, sandboxOrigin })) return;
  // localhost is reserved for the cross-origin MCP sandbox. Only top-level UI
  // navigation redirects; its API, asset, iframe and socket requests stay denied.
  if (req.headers.host === `localhost:${port}` && req.method === 'GET' && req.headers['sec-fetch-dest'] === 'document' && req.headers['sec-fetch-mode'] === 'navigate' && !/^\/(api|mcp|connect|__vite_hmr)(\/|$)/.test(req.url ?? '/')) {
    const redirect = new URL(req.url ?? '/', hostOrigin);
    res.writeHead(307, { location: `${hostOrigin}${redirect.pathname}${redirect.search}` }); res.end(); return;
  }
  if (req.headers.host !== `127.0.0.1:${port}` || !isLocalRequest(req, port)) return json(res, 403, { error: 'This server accepts same-origin local requests only.' });
  res.setHeader('content-security-policy', `frame-src 'self' ${sandboxOrigin}; object-src 'none'; base-uri 'self'`);
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'present', version: '0.1.0' });
    if (await handleSceneRequest(req, res) || await handlePlaybook(req, res)) return;
    if (await handleReactiveBenchmark(req, res)) return;
    if (await handleBenchmark(req, res)) return;
    if (await handleRoomRequest(req, res)) return;
    if (await handleAssetRequest(req, res)) return;
    if (handleEmbedRequest(req, res)) return;
    if (await handleWorkRequest(req, res)) return;
    if (await handleActivityRequest(req, res)) return;
    if (await handleMcpRequest(req, res)) return;
    if (await handleAgentRequest(req, res)) return;
    if (await handleMediaRequest(req, res)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API route.' });
    if (vite) return vite.middlewares(req, res, () => json(res, 404, { error: 'Not found.' }));
    return serveDist(req, res, url.pathname, join(process.cwd(), 'dist'));
  } catch (error) {
    if (res.headersSent) { res.end(); return; }
    json(res, error instanceof RoomError ? error.status : 500, { error: error instanceof RoomError ? error.message : 'The request could not be completed.' });
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.on('upgrade', (req, socket) => {
  const path = (req.url ?? '').split('?')[0];
  const allowed = path === '/connect' || (process.env.NODE_ENV !== 'production' && path === '/__vite_hmr');
  if (req.headers.host !== `127.0.0.1:${port}` || !isLocalRequest(req, port) || !allowed) socket.destroy();
});
const closeSockets = attachRoomSocket(server, port);
let vite: import('vite').ViteDevServer | undefined;
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ server: { middlewareMode: true, hmr: { server, path: '/__vite_hmr' } }, appType: 'spa' });
}
const sweep = setInterval(sweepExpired, 5_000);
sweep.unref();
server.listen(port, '127.0.0.1', () => console.log(`PRESENT is ready at http://127.0.0.1:${port}`));
async function shutdown() {
  if (closing) return;
  closing = true;
  cancelAgentRequests();
  activityEngine.close();
  closeWorkJobs();
  closeScenes();
  clearInterval(sweep);
  closeSockets();
  await closeCodexSession();
  await vite?.close();
  const finish = () => { closeRoomStore(); process.exit(0); };
  server.close(finish);
  setTimeout(() => { server.closeAllConnections(); finish(); }, 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
