import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import WebSocket from 'ws';
import { z } from 'zod';
import {
  createCodexBrokerServiceFromEnv,
  createCodexBrokerSessionInputSchema,
  type CodexBrokerService,
} from './service';

const sessionIdSchema = z.object({
  sessionId: z.string().min(1),
  '*': z.string().optional(),
});

const shouldForwardHeader = (name: string) =>
  ![
    'host',
    'connection',
    'upgrade',
    'keep-alive',
    'proxy-connection',
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-extensions',
    'sec-websocket-accept',
  ].includes(name.toLowerCase());

const normalizeForwardHeaders = (headers: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => shouldForwardHeader(name))
      .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value ?? '']),
  );

const buildTargetUrl = (baseUrl: string, suffix: string | undefined, search: string, asWebSocket = false) => {
  const url = new URL(baseUrl);
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const extraPath = suffix ? `/${suffix.replace(/^\/+/, '')}` : '';
  url.pathname = `${basePath}${extraPath}` || '/';
  url.search = search;
  if (asWebSocket) {
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  }
  return url;
};

const resolvePublicBaseUrl = (request: FastifyRequest, configured?: string | null) => {
  if (configured) return configured;
  const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol);
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '127.0.0.1');
  return `${proto}://${host}`;
};

async function proxyHttpRequest(request: FastifyRequest, reply: any, service: CodexBrokerService) {
  const params = sessionIdSchema.parse(request.params ?? {});
  const record = service.getSessionRecord(params.sessionId);
  if (!record) {
    reply.code(404).send({ error: 'Codex broker session not found.' });
    return;
  }
  service.touchSession(params.sessionId, { publicBaseUrl: 'http://broker.local' });

  const requestUrl = new URL(request.raw.url ?? '/', 'http://broker.local');
  const targetUrl = buildTargetUrl(record.targetBaseUrl, params['*'], requestUrl.search);

  const method = request.method.toUpperCase();
  const requestInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers: normalizeForwardHeaders(request.headers as Record<string, string | string[] | undefined>),
    body: method === 'GET' || method === 'HEAD' ? undefined : (request.raw as any),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    requestInit.duplex = 'half';
  }

  const upstreamResponse = await fetch(targetUrl, requestInit);

  reply.code(upstreamResponse.status);
  upstreamResponse.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'content-length') return;
    reply.header(name, value);
  });

  const setCookie =
    typeof (upstreamResponse.headers as any).getSetCookie === 'function'
      ? (upstreamResponse.headers as any).getSetCookie()
      : [];
  if (Array.isArray(setCookie) && setCookie.length > 0) {
    reply.header('set-cookie', setCookie);
  }

  if (!upstreamResponse.body) {
    reply.send();
    return;
  }

  await pipeline(Readable.fromWeb(upstreamResponse.body as never), reply.raw);
}

function proxyWebSocket(request: FastifyRequest, socket: WebSocket, service: CodexBrokerService) {
  const params = sessionIdSchema.parse(request.params ?? {});
  const record = service.getSessionRecord(params.sessionId);
  if (!record) {
    socket.close(1011, 'Session not found');
    return;
  }
  service.touchSession(params.sessionId, { publicBaseUrl: 'http://broker.local' });
  const requestUrl = new URL(request.raw.url ?? '/', 'http://broker.local');
  const targetUrl = buildTargetUrl(record.targetBaseUrl, params['*'], requestUrl.search, true);
  const upstream = new WebSocket(targetUrl, {
    headers: normalizeForwardHeaders(request.headers as Record<string, string | string[] | undefined>),
  });

  socket.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });

  upstream.on('message', (data, isBinary) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary });
    }
  });

  const closeBoth = (code?: number, reason?: Buffer) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(code, reason?.toString());
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close(code, reason?.toString());
    }
  };

  socket.on('close', (code, reason) => closeBoth(code, reason as Buffer));
  upstream.on('close', (code, reason) => closeBoth(code, reason as Buffer));
  socket.on('error', () => closeBoth(1011));
  upstream.on('error', () => closeBoth(1011));
}

export async function buildCodexBrokerServer(options: { service?: CodexBrokerService } = {}) {
  const service = options.service ?? createCodexBrokerServiceFromEnv();
  const app = fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocketPlugin);

  app.get('/health', async () => ({ ok: true }));

  app.post('/sessions', async (request, reply) => {
    try {
      const payload = createCodexBrokerSessionInputSchema.parse(request.body ?? {});
      const session = await service.createSession(payload, {
        publicBaseUrl: resolvePublicBaseUrl(request, process.env.CODEX_BROKER_PUBLIC_BASE_URL ?? null),
      });
      reply.code(201).send({ session });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create session.' });
    }
  });

  app.get('/sessions/:sessionId', async (request, reply) => {
    const params = sessionIdSchema.parse(request.params ?? {});
    const session = service.touchSession(params.sessionId, {
      publicBaseUrl: resolvePublicBaseUrl(request, process.env.CODEX_BROKER_PUBLIC_BASE_URL ?? null),
    });
    if (!session) {
      reply.code(404).send({ error: 'Codex broker session not found.' });
      return;
    }
    reply.send({ session });
  });

  app.delete('/sessions/:sessionId', async (request, reply) => {
    const params = sessionIdSchema.parse(request.params ?? {});
    const deleted = await service.deleteSession(params.sessionId);
    if (!deleted) {
      reply.code(404).send({ error: 'Codex broker session not found.' });
      return;
    }
    reply.send({ deleted: true });
  });

  app.route({
    method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    url: '/sessions/:sessionId/proxy',
    handler: async (request, reply) => {
      await proxyHttpRequest(request, reply, service);
    },
  });

  app.route({
    method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    url: '/sessions/:sessionId/proxy/*',
    handler: async (request, reply) => {
      await proxyHttpRequest(request, reply, service);
    },
  });

  app.route({
    method: 'GET',
    url: '/sessions/:sessionId/proxy',
    handler: async (request, reply) => {
      await proxyHttpRequest(request, reply, service);
    },
    wsHandler: async (socket, request) => {
      proxyWebSocket(request, socket, service);
    },
  });

  app.route({
    method: 'GET',
    url: '/sessions/:sessionId/proxy/*',
    handler: async (request, reply) => {
      await proxyHttpRequest(request, reply, service);
    },
    wsHandler: async (socket, request) => {
      proxyWebSocket(request, socket, service);
    },
  });

  app.addHook('onClose', async () => {
    await service.close();
  });

  return app;
}

async function main() {
  const app = await buildCodexBrokerServer();
  const port = Number(process.env.CODEX_BROKER_PORT ?? '4101');
  const host = process.env.CODEX_BROKER_HOST ?? '127.0.0.1';
  await app.listen({ port, host });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
