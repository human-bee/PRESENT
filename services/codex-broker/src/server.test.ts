/** @jest-environment node */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
const wsModule = require('ws') as typeof import('ws');
const WebSocket = (wsModule.default ?? wsModule) as typeof wsModule.WebSocket & {
  Server?: typeof wsModule.WebSocketServer;
};
const WebSocketServer = (wsModule.WebSocketServer ?? wsModule.Server) as typeof wsModule.WebSocketServer;
if (!WebSocket.Server) {
  WebSocket.Server = WebSocketServer;
}

const { buildCodexBrokerServer } = require('./server') as typeof import('./server');
const { CodexBrokerService } = require('./service') as typeof import('./service');

jest.setTimeout(15_000);

const BROKER_AUTH_TOKEN = 'test-broker-token';

const listenHttpServer = async (server: http.Server) => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP listener address.');
  }
  return `http://127.0.0.1:${address.port}`;
};

const closeHttpServer = async (server: http.Server) => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

describe('Codex broker server', () => {
  const originalBrokerAuthToken = process.env.CODEX_BROKER_AUTH_TOKEN;

  beforeEach(() => {
    process.env.CODEX_BROKER_AUTH_TOKEN = BROKER_AUTH_TOKEN;
  });

  afterEach(() => {
    if (originalBrokerAuthToken === undefined) {
      delete process.env.CODEX_BROKER_AUTH_TOKEN;
      return;
    }
    process.env.CODEX_BROKER_AUTH_TOKEN = originalBrokerAuthToken;
  });

  it('creates, returns, and deletes broker sessions through the server routes', async () => {
    const service = new CodexBrokerService({
      directTargetUrl: 'http://127.0.0.1:65535/',
    });
    const app = await buildCodexBrokerServer({
      service,
    });

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          authorization: `Bearer ${BROKER_AUTH_TOKEN}`,
          host: 'broker.test',
        },
        payload: {
          workspaceSessionId: 'ws_123',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const createdPayload = createResponse.json() as {
        session: {
          sessionId: string;
          workspaceSessionId: string;
          remoteWorkingDirectory: string;
          proxyBaseUrl: string;
          frameUrl: string;
          status: string;
        };
      };
      expect(createdPayload.session.workspaceSessionId).toBe('ws_123');
      expect(createdPayload.session.remoteWorkingDirectory).toBe('/srv/codex/repos/PRESENT');
      expect(createdPayload.session.status).toBe('ready');
      expect(createdPayload.session.proxyBaseUrl).toContain(`/sessions/${createdPayload.session.sessionId}/proxy`);
      expect(createdPayload.session.proxyBaseUrl).toMatch(
        new RegExp(`/sessions/${createdPayload.session.sessionId}/proxy/[^/]+$`),
      );
      expect(createdPayload.session.frameUrl).toContain(`/sessions/${createdPayload.session.sessionId}/proxy/`);
      expect(createdPayload.session.frameUrl).toMatch(
        new RegExp(`/sessions/${createdPayload.session.sessionId}/proxy/[^/]+/$`),
      );
      expect(service.getSessionRecord(createdPayload.session.sessionId)?.proxyAccessToken).toBeTruthy();

      const getResponse = await app.inject({
        method: 'GET',
        url: `/sessions/${createdPayload.session.sessionId}`,
        headers: {
          authorization: `Bearer ${BROKER_AUTH_TOKEN}`,
          host: 'broker.test',
        },
      });

      expect(getResponse.statusCode).toBe(200);
      const fetchedPayload = getResponse.json() as typeof createdPayload;
      expect(fetchedPayload.session).toMatchObject({
        sessionId: createdPayload.session.sessionId,
        workspaceSessionId: 'ws_123',
        remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        status: 'ready',
      });

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/sessions/${createdPayload.session.sessionId}`,
        headers: {
          authorization: `Bearer ${BROKER_AUTH_TOKEN}`,
          host: 'broker.test',
        },
      });

      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toEqual({ deleted: true });

      const missingResponse = await app.inject({
        method: 'GET',
        url: `/sessions/${createdPayload.session.sessionId}`,
        headers: {
          authorization: `Bearer ${BROKER_AUTH_TOKEN}`,
          host: 'broker.test',
        },
      });

      expect(missingResponse.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('forwards proxied POST request bodies to the upstream target', async () => {
    let upstreamRequest:
      | {
          method: string | undefined;
          url: string | undefined;
          body: string;
          contentType: string | undefined;
          customHeader: string | undefined;
        }
      | null = null;
    const upstreamServer = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        upstreamRequest = {
          method: request.method,
          url: request.url,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: request.headers['content-type'],
          customHeader: request.headers['x-test-header'],
        };
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(upstreamRequest));
      });
    });
    const upstreamBaseUrl = await listenHttpServer(upstreamServer);

    const service = new CodexBrokerService({
      directTargetUrl: `${upstreamBaseUrl}/`,
    });
    const app = await buildCodexBrokerServer({ service });

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: {
          authorization: `Bearer ${BROKER_AUTH_TOKEN}`,
          host: 'broker.test',
        },
        payload: {
          workspaceSessionId: 'ws_456',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        },
      });
      const { session } = createResponse.json() as { session: { sessionId: string } };
      const accessToken = service.getSessionRecord(session.sessionId)?.proxyAccessToken;
      if (!accessToken) {
        throw new Error('Expected broker session record to expose a proxy access token.');
      }
      const forwardedUrl = `/sessions/${session.sessionId}/proxy/${accessToken}/api/echo?foo=bar`;

      const proxyResponse = await app.inject({
        method: 'POST',
        url: forwardedUrl,
        headers: {
          host: 'broker.test',
          'content-type': 'application/json',
          'x-test-header': 'alpha',
        },
        payload: {
          hello: 'world',
          nested: { ok: true },
        },
      });

      expect(proxyResponse.statusCode).toBe(200);
      expect(proxyResponse.json()).toEqual({
        method: 'POST',
        url: '/api/echo?foo=bar',
        body: JSON.stringify({
          hello: 'world',
          nested: { ok: true },
        }),
        contentType: 'application/json',
        customHeader: 'alpha',
      });
      expect(upstreamRequest).toEqual({
        method: 'POST',
        url: '/api/echo?foo=bar',
        body: JSON.stringify({
          hello: 'world',
          nested: { ok: true },
        }),
        contentType: 'application/json',
        customHeader: 'alpha',
      });
    } finally {
      await app.close();
      await closeHttpServer(upstreamServer);
    }
  });

  it('buffers websocket messages until the upstream socket opens', async () => {
    const upstreamServer = http.createServer();
    const upstreamSocketServer = new WebSocketServer({ noServer: true });
    const upstreamMessages: string[] = [];
    upstreamSocketServer.on('connection', (socket) => {
      socket.on('message', (data) => {
        const text = data.toString();
        upstreamMessages.push(text);
        socket.send(`echo:${text}`);
      });
    });
    upstreamServer.on('upgrade', (request, socket, head) => {
      setTimeout(() => {
        upstreamSocketServer.handleUpgrade(request, socket, head, (upstreamSocket) => {
          upstreamSocketServer.emit('connection', upstreamSocket, request);
        });
      }, 75);
    });
    const upstreamBaseUrl = await listenHttpServer(upstreamServer);

    const service = new CodexBrokerService({
      directTargetUrl: `${upstreamBaseUrl}/`,
    });
    const app = await buildCodexBrokerServer({ service });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const brokerAddress = app.server.address() as AddressInfo | null;
    if (!brokerAddress || typeof brokerAddress === 'string') {
      throw new Error('Expected broker TCP listener address.');
    }
    const brokerBaseUrl = `http://127.0.0.1:${brokerAddress.port}`;

    let client: WebSocket | null = null;
    try {
      const createResponse = await fetch(`${brokerBaseUrl}/sessions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${BROKER_AUTH_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workspaceSessionId: 'ws_789',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        }),
      });
      expect(createResponse.status).toBe(201);
      const { session } = (await createResponse.json()) as {
        session: { sessionId: string };
      };
      const accessToken = service.getSessionRecord(session.sessionId)?.proxyAccessToken;
      if (!accessToken) {
        throw new Error('Expected broker session record to expose a proxy access token.');
      }
      const websocketUrl = new URL(
        `${brokerBaseUrl}/sessions/${session.sessionId}/proxy/${accessToken}/events`,
      );
      websocketUrl.protocol = 'ws:';

      client = new WebSocket(websocketUrl);
      const echoedMessage = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for broker websocket echo.'));
        }, 2_000);

        client.on('message', (data) => {
          clearTimeout(timeout);
          resolve(data.toString());
        });
        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send('hello-before-upstream-open');
          resolve();
        });
        client.once('error', reject);
      });

      await expect(echoedMessage).resolves.toBe('echo:hello-before-upstream-open');
      expect(upstreamMessages).toEqual(['hello-before-upstream-open']);
    } finally {
      if (client) {
        await new Promise<void>((resolve) => {
          client.once('close', () => resolve());
          client.close();
        });
      }
      await app.close();
      upstreamSocketServer.close();
      await closeHttpServer(upstreamServer);
    }
  });
});
