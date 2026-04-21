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

const proxyParamsSchema = z.object({
  sessionId: z.string().min(1),
  accessToken: z.string().min(1),
  '*': z.string().optional(),
});

const shouldForwardHeader = (name: string) =>
  ![
    'host',
    'content-length',
    'connection',
    'upgrade',
    'keep-alive',
    'proxy-connection',
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-extensions',
    'sec-websocket-accept',
  ].includes(name.toLowerCase());

const isLoopbackAddress = (value: string | undefined) => {
  if (!value) return false;
  const normalized = value.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
};

const normalizeForwardHeaders = (headers: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => shouldForwardHeader(name))
      .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value ?? '']),
  );

const normalizeWebSocketCloseCode = (code?: number) => {
  if (typeof code !== 'number') {
    return undefined;
  }
  if ((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999)) {
    return code;
  }
  return undefined;
};

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

const parseRequestBody = (request: FastifyRequest) => {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }
  const body = (request as { body?: unknown }).body;
  if (body == null) {
    return undefined;
  }
  if (
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams
  ) {
    return body;
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  return JSON.stringify(body);
};

function isAuthorizedBrokerAdminRequest(request: FastifyRequest) {
  const expectedToken = process.env.CODEX_BROKER_AUTH_TOKEN?.trim();
  const header = request.headers.authorization;
  if (expectedToken) {
    return header === `Bearer ${expectedToken}`;
  }
  const forwardedFor = request.headers['x-forwarded-for'];
  const forwardedAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]?.trim();
  return isLoopbackAddress(forwardedAddress) || isLoopbackAddress(request.ip) || isLoopbackAddress(request.socket.remoteAddress);
}

function assertAuthorizedBrokerAdminRequest(request: FastifyRequest, reply: any) {
  if (isAuthorizedBrokerAdminRequest(request)) {
    return true;
  }
  reply.code(401).send({ error: 'Broker admin authorization required.' });
  return false;
}

function assertProxyAccess(
  request: FastifyRequest,
  reply: any,
  params: { accessToken: string },
  record: { proxyAccessToken: string },
) {
  if (params.accessToken === record.proxyAccessToken) {
    return new URL(request.raw.url ?? '/', 'http://broker.local');
  }
  reply.code(403).send({ error: 'Codex broker proxy access denied.' });
  return null;
}

async function proxyHttpRequest(request: FastifyRequest, reply: any, service: CodexBrokerService) {
  const params = proxyParamsSchema.parse(request.params ?? {});
  const record = service.getSessionRecord(params.sessionId);
  if (!record) {
    reply.code(404).send({ error: 'Codex broker session not found.' });
    return;
  }
  service.touchSession(params.sessionId, { publicBaseUrl: 'http://broker.local' });
  const requestUrl = assertProxyAccess(request, reply, params, record);
  if (!requestUrl) {
    return;
  }
  const targetUrl = buildTargetUrl(record.targetBaseUrl, params['*'], requestUrl.search);

  const method = request.method.toUpperCase();
  const requestBody = parseRequestBody(request);
  const requestInit: RequestInit = {
    method,
    headers: normalizeForwardHeaders(request.headers as Record<string, string | string[] | undefined>),
    body: requestBody as BodyInit | null | undefined,
    redirect: 'manual',
  };

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
  const params = proxyParamsSchema.parse(request.params ?? {});
  const record = service.getSessionRecord(params.sessionId);
  if (!record) {
    socket.close(1011, 'Session not found');
    return;
  }
  const requestUrl = new URL(request.raw.url ?? '/', 'http://broker.local');
  if (params.accessToken !== record.proxyAccessToken) {
    socket.close(1008, 'Access denied');
    return;
  }
  service.touchSession(params.sessionId, { publicBaseUrl: 'http://broker.local' });
  const targetUrl = buildTargetUrl(record.targetBaseUrl, params['*'], requestUrl.search, true);
  const upstream = new WebSocket(targetUrl, {
    headers: normalizeForwardHeaders(request.headers as Record<string, string | string[] | undefined>),
  });
  const pendingMessages: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];

  socket.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }
    if (upstream.readyState === WebSocket.CONNECTING) {
      pendingMessages.push({ data, isBinary });
    }
  });

  upstream.on('open', () => {
    while (pendingMessages.length > 0 && upstream.readyState === WebSocket.OPEN) {
      const next = pendingMessages.shift();
      if (!next) break;
      upstream.send(next.data, { binary: next.isBinary });
    }
  });

  upstream.on('message', (data, isBinary) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary });
    }
  });

  const closeBoth = (code?: number, reason?: Buffer) => {
    const closeCode = normalizeWebSocketCloseCode(code);
    const closeReason = reason?.toString();
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(closeCode, closeReason);
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close(closeCode, closeReason);
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
  const configuredPublicBaseUrl = process.env.CODEX_BROKER_PUBLIC_BASE_URL?.trim() ?? null;
  const allowedOrigins = new Set<string>();
  if (configuredPublicBaseUrl) {
    allowedOrigins.add(new URL(configuredPublicBaseUrl).origin);
  }

  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.has(origin));
    },
  });
  await app.register(websocketPlugin);

  app.get('/health', async () => ({ ok: true }));

  app.post('/sessions', async (request, reply) => {
    try {
      if (!assertAuthorizedBrokerAdminRequest(request, reply)) {
        return;
      }
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
    if (!assertAuthorizedBrokerAdminRequest(request, reply)) {
      return;
    }
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
    if (!assertAuthorizedBrokerAdminRequest(request, reply)) {
      return;
    }
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
    url: '/sessions/:sessionId/proxy/:accessToken',
    handler: async (request, reply) => {
      await proxyHttpRequest(request, reply, service);
    },
  });

  app.route({
    method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    url: '/sessions/:sessionId/proxy/:accessToken/*',
    handler: async (request, reply) => {
      await proxyHttpRequest(request, reply, service);
    },
  });

  app.route({
    method: 'GET',
    url: '/sessions/:sessionId/proxy/:accessToken',
    handler: async (request, reply) => {
      await proxyHttpRequest(request, reply, service);
    },
    wsHandler: async (socket, request) => {
      proxyWebSocket(request, socket, service);
    },
  });

  app.route({
    method: 'GET',
    url: '/sessions/:sessionId/proxy/:accessToken/*',
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

export async function main() {
  const app = await buildCodexBrokerServer();
  const port = Number(process.env.CODEX_BROKER_PORT ?? process.env.PORT ?? '4101');
  const host =
    process.env.CODEX_BROKER_HOST ??
    process.env.HOST ??
    (process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
  await app.listen({ port, host });
}

const resolveCurrentModulePath = () => {
  try {
    const moduleUrl = Function('return import.meta.url')() as string;
    return fileURLToPath(moduleUrl);
  } catch {
    return null;
  }
};

if (process.argv[1] && resolveCurrentModulePath() === process.argv[1]) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
