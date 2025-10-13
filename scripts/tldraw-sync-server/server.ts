import fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import cors from '@fastify/cors';
import type { RawData } from 'ws';
import { makeOrLoadRoom, resetRoom } from './rooms';
import { loadAsset, storeAsset } from './storage';

const PORT = Number(process.env.TLDRAW_SYNC_PORT ?? 3100);

/**
 * Minimal tldraw sync server based on the official simple-server-example.
 * Provides:
 *  - WebSocket endpoint:  GET /connect/:roomId
 *  - Asset upload/download: PUT/GET /uploads/:id
 *
 * This server is for local development; add authentication, rate limiting,
 * and persistent storage before using it in production.
 */
async function buildServer() {
  const app = fastify();
  await app.register(websocketPlugin);
  await app.register(cors, { origin: '*' });

  app.get('/connect/:roomId', { websocket: true }, async (socket, request) => {
    const { roomId } = request.params as { roomId: string };
    const sessionId = (request.query as Record<string, unknown>)?.sessionId as string | undefined;

    // Collect messages that arrive before the room is ready.
    const caughtMessages: RawData[] = [];
    const collect = (message: RawData) => caughtMessages.push(message);
    socket.on('message', collect);

    const room = await makeOrLoadRoom(roomId);
    room.handleSocketConnect({ sessionId, socket });

    socket.off('message', collect);
    for (const message of caughtMessages) {
      socket.emit('message', message);
    }
  });

  app.addContentTypeParser('*', (_, __, done) => done(null));

  app.put('/uploads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await storeAsset(id, request.raw);
    reply.send({ ok: true });
  });

  app.get('/uploads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = await loadAsset(id);
    if (!data) {
      reply.code(404).send({ ok: false, error: 'Asset not found' });
      return;
    }
    reply.header('Content-Type', 'application/octet-stream').send(data);
  });

  app.post('/admin/reset-room/:roomId', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    await resetRoom(roomId);
    reply.send({ ok: true });
  });

  return app;
}

buildServer()
  .then((app) => {
    app.listen({ port: PORT, host: '127.0.0.1' }, (err) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }

      app.log.info(`tldraw sync server listening on http://127.0.0.1:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('[tldraw-sync] failed to start server', error);
    process.exit(1);
  });
