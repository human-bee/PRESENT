import type { ExecutionContext } from '@cloudflare/workers-types';
import { TldrawRoomDurableObject, type Env as RoomEnv } from './room';

export interface Env extends RoomEnv {
  TLDRAW_ROOM: DurableObjectNamespace;
  TLDRAW_UPLOADS: R2Bucket;
  SYNC_ADMIN_TOKEN?: string;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function checkAdminAuth(request: Request, env: Env): boolean {
  const required = env.SYNC_ADMIN_TOKEN?.trim() || '';
  if (!required) return false;
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match?.[1] && match[1].trim() === required;
}

async function handleUploads(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method === 'PUT') {
    const data = await request.arrayBuffer();
    await env.TLDRAW_UPLOADS.put(id, data, {
      httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
    });
    return Response.json({ ok: true }, { headers: corsHeaders() });
  }
  if (request.method === 'GET') {
    const obj = await env.TLDRAW_UPLOADS.get(id);
    if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders() });
    const headers = new Headers(corsHeaders());
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    return new Response(obj.body, { status: 200, headers });
  }
  return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
}

async function handleConnect(request: Request, env: Env, roomId: string): Promise<Response> {
  const id = env.TLDRAW_ROOM.idFromName(roomId);
  const stub = env.TLDRAW_ROOM.get(id);
  // Route the same request to the DO; keep path/query intact.
  return stub.fetch(request);
}

async function handleResetRoom(request: Request, env: Env, roomId: string): Promise<Response> {
  if (!checkAdminAuth(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders() });
  }
  const id = env.TLDRAW_ROOM.idFromName(roomId);
  const stub = env.TLDRAW_ROOM.get(id);
  const url = new URL(request.url);
  url.pathname = '/admin/reset';
  const res = await stub.fetch(url.toString(), { method: 'POST' });
  const headers = new Headers(corsHeaders());
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const connectMatch = path.match(/^\/connect\/([^/]+)$/);
    if (connectMatch) {
      const roomId = decodeURIComponent(connectMatch[1]);
      return handleConnect(request, env, roomId);
    }

    const uploadMatch = path.match(/^\/uploads\/([^/]+)$/);
    if (uploadMatch) {
      const id = decodeURIComponent(uploadMatch[1]);
      return handleUploads(request, env, id);
    }

    const resetMatch = path.match(/^\/admin\/reset-room\/([^/]+)$/);
    if (resetMatch && request.method === 'POST') {
      const roomId = decodeURIComponent(resetMatch[1]);
      return handleResetRoom(request, env, roomId);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
};

export { TldrawRoomDurableObject };

