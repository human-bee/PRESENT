import { fileURLToPath } from 'node:url';
import fastify from 'fastify';
import cors from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import type WebSocket from 'ws';
import {
  createWidgetCodexServiceFromEnv,
  widgetCodexCompleteAuthInputSchema,
  widgetCodexCreateConnectionInputSchema,
  widgetCodexServerInputSchema,
  widgetCodexServerPatchSchema,
  type WidgetCodexService,
} from './service';

type WidgetCodexWebSocketMessage =
  | {
      type: 'subscribe';
      widgetSessionId?: string | null;
    }
  | {
      type: 'ping';
    };

const isOriginAllowed = (origin: string | undefined, allowedOrigins: Set<string>) => {
  if (!origin) return true;
  if (allowedOrigins.size === 0) return true;
  return allowedOrigins.has(origin);
};

function sendJson(socket: WebSocket, payload: unknown) {
  socket.send(JSON.stringify(payload));
}

export async function buildWidgetCodexServer(options: { service?: WidgetCodexService } = {}) {
  const service = options.service ?? createWidgetCodexServiceFromEnv();
  await service.hydrate();

  const app = fastify({ logger: false });
  const allowedOrigins = new Set<string>();
  const configuredOrigin = process.env.WIDGET_CODEX_ALLOWED_ORIGIN?.trim();
  if (configuredOrigin) {
    allowedOrigins.add(configuredOrigin);
  }
  const widgetOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (widgetOrigin) {
    allowedOrigins.add(widgetOrigin);
  }

  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      callback(null, isOriginAllowed(origin, allowedOrigins));
    },
  });
  await app.register(websocketPlugin);

  app.get('/health', async () => ({
    ok: true,
    runtime: service.getRuntimeStatus(),
  }));

  app.get('/servers', async () => ({
    realtimeUrl: process.env.WIDGET_CODEX_PUBLIC_WS_URL ?? null,
    servers: service.listServers(),
  }));

  app.post('/servers', async (request, reply) => {
    try {
      const server = await service.createServer(widgetCodexServerInputSchema.parse(request.body ?? {}));
      reply.code(201).send({ server });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create widget Codex server.' });
    }
  });

  app.patch('/servers/:serverId', async (request, reply) => {
    try {
      const serverId = String((request.params as { serverId?: string } | undefined)?.serverId ?? '');
      const server = await service.updateServer(serverId, widgetCodexServerPatchSchema.parse(request.body ?? {}));
      if (!server) {
        reply.code(404).send({ error: 'Widget Codex server not found.' });
        return;
      }
      reply.send({ server });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to update widget Codex server.' });
    }
  });

  app.delete('/servers/:serverId', async (request, reply) => {
    const serverId = String((request.params as { serverId?: string } | undefined)?.serverId ?? '');
    const deleted = await service.deleteServer(serverId);
    if (!deleted) {
      reply.code(404).send({ error: 'Widget Codex server not found.' });
      return;
    }
    reply.send({ deleted: true });
  });

  app.get('/servers/:serverId/workspaces', async (request, reply) => {
    const serverId = String((request.params as { serverId?: string } | undefined)?.serverId ?? '');
    const workspaces = service.listWorkspaces(serverId);
    if (!workspaces) {
      reply.code(404).send({ error: 'Widget Codex server not found.' });
      return;
    }
    reply.send({ workspaces });
  });

  app.post('/servers/:serverId/auth/start', async (request, reply) => {
    const serverId = String((request.params as { serverId?: string } | undefined)?.serverId ?? '');
    const result = await service.startAuth(serverId);
    if (!result) {
      reply.code(404).send({ error: 'Widget Codex server not found.' });
      return;
    }
    reply.send(result);
  });

  app.post('/servers/:serverId/auth/complete', async (request, reply) => {
    try {
      const serverId = String((request.params as { serverId?: string } | undefined)?.serverId ?? '');
      const server = await service.completeAuth(serverId, widgetCodexCompleteAuthInputSchema.parse(request.body ?? {}));
      if (!server) {
        reply.code(404).send({ error: 'Widget Codex server not found.' });
        return;
      }
      reply.send({ server });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to complete Widget Codex auth.' });
    }
  });

  app.post('/connections', async (request, reply) => {
    try {
      const payload = widgetCodexCreateConnectionInputSchema.parse(request.body ?? {});
      const result = await service.createConnection(payload);
      reply.code(201).send(result);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create widget Codex connection.' });
    }
  });

  app.get('/connections/:connectionId', async (request, reply) => {
    const connectionId = String((request.params as { connectionId?: string } | undefined)?.connectionId ?? '');
    const connection = await service.refreshConnection(connectionId);
    if (!connection) {
      reply.code(404).send({ error: 'Widget Codex connection not found.' });
      return;
    }
    reply.send({ connection });
  });

  app.delete('/connections/:connectionId', async (request, reply) => {
    const connectionId = String((request.params as { connectionId?: string } | undefined)?.connectionId ?? '');
    const deleted = await service.deleteConnection(connectionId);
    if (!deleted) {
      reply.code(404).send({ error: 'Widget Codex connection not found.' });
      return;
    }
    reply.send({ deleted: true });
  });

  app.get('/widgets/:widgetSessionId', async (request) => {
    const widgetSessionId = String((request.params as { widgetSessionId?: string } | undefined)?.widgetSessionId ?? '');
    return service.getSnapshot(widgetSessionId);
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    const queryWidgetSessionId =
      typeof (request.query as { widgetSessionId?: string } | undefined)?.widgetSessionId === 'string'
        ? (request.query as { widgetSessionId: string }).widgetSessionId
        : null;

    let activeWidgetSessionId = queryWidgetSessionId;
    const unsubscribe = service.subscribe((snapshot) => {
      if (activeWidgetSessionId && snapshot.widgetSession?.id !== activeWidgetSessionId) {
        return;
      }
      sendJson(socket, {
        type: 'snapshot',
        payload: snapshot,
      });
    });

    sendJson(socket, {
      type: 'snapshot',
      payload: service.getSnapshot(activeWidgetSessionId),
    });

    socket.on('message', (buffer) => {
      try {
        const payload = JSON.parse(buffer.toString()) as WidgetCodexWebSocketMessage;
        if (payload.type === 'subscribe') {
          activeWidgetSessionId = payload.widgetSessionId ?? null;
          sendJson(socket, {
            type: 'snapshot',
            payload: service.getSnapshot(activeWidgetSessionId),
          });
          return;
        }
        if (payload.type === 'ping') {
          sendJson(socket, { type: 'pong' });
        }
      } catch {
        sendJson(socket, { type: 'error', error: 'Invalid widget Codex websocket payload.' });
      }
    });

    socket.on('close', () => {
      unsubscribe();
    });
  });

  app.addHook('onClose', async () => {
    await service.close();
  });

  return app;
}

export async function main() {
  const app = await buildWidgetCodexServer();
  const port = Number(process.env.WIDGET_CODEX_PORT ?? process.env.PORT ?? '4102');
  const host =
    process.env.WIDGET_CODEX_HOST ??
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
