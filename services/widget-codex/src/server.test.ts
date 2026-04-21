/** @jest-environment node */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const { buildWidgetCodexServer } = require('./server') as typeof import('./server');
const { WidgetCodexService } = require('./service') as typeof import('./service');

describe('Widget Codex server', () => {
  let stateFilePath: string;

  beforeEach(async () => {
    stateFilePath = path.join(
      os.tmpdir(),
      `present-widget-codex-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    await fs.rm(stateFilePath, { force: true });
  });

  afterEach(async () => {
    await fs.rm(stateFilePath, { force: true });
  });

  it('creates servers, starts auth, creates connections, refreshes them, and disconnects cleanly', async () => {
    const broker = {
      createSession: jest.fn().mockResolvedValue({
        session: {
          sessionId: 'cxs_widget',
          workspaceSessionId: 'wcws_123',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
          proxyBaseUrl: 'http://127.0.0.1:4101/sessions/cxs_widget/proxy/token',
          frameUrl: 'http://127.0.0.1:4101/sessions/cxs_widget/proxy/token/',
          status: 'ready',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        },
      }),
      getSession: jest.fn().mockResolvedValue({
        session: {
          sessionId: 'cxs_widget',
          workspaceSessionId: 'wcws_123',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
          proxyBaseUrl: 'http://127.0.0.1:4101/sessions/cxs_widget/proxy/token',
          frameUrl: 'http://127.0.0.1:4101/sessions/cxs_widget/proxy/token/',
          status: 'ready',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        },
      }),
      deleteSession: jest.fn().mockResolvedValue({ deleted: true }),
    };

    const service = new WidgetCodexService({
      stateFilePath,
      realtimeUrl: 'ws://127.0.0.1:4102/ws',
      broker,
    });
    const app = await buildWidgetCodexServer({ service });

    try {
      const createServerResponse = await app.inject({
        method: 'POST',
        url: '/servers',
        payload: {
          label: 'Remote Prod',
          directTargetUrl: 'https://remote-codex.example/',
          authStrategy: 'external_url',
          authUrl: 'https://remote-codex.example/login',
          workspaces: [
            {
              id: 'present',
              label: 'PRESENT',
              path: '/srv/codex/repos/PRESENT',
            },
          ],
        },
      });

      expect(createServerResponse.statusCode).toBe(201);
      const createdServer = createServerResponse.json().server as { id: string; authState: string };
      expect(createdServer.authState).toBe('login_required');

      const authStartResponse = await app.inject({
        method: 'POST',
        url: `/servers/${createdServer.id}/auth/start`,
      });
      expect(authStartResponse.statusCode).toBe(200);
      expect(authStartResponse.json()).toMatchObject({
        authState: 'pending',
        loginUrl: 'https://remote-codex.example/login',
      });

      const authCompleteResponse = await app.inject({
        method: 'POST',
        url: `/servers/${createdServer.id}/auth/complete`,
        payload: {
          widgetSessionId: 'wcws_123',
          remoteWorkspaceId: 'present',
        },
      });
      expect(authCompleteResponse.statusCode).toBe(200);
      expect(authCompleteResponse.json().server.authState).toBe('authenticated');
      expect(broker.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceSessionId: 'wcws_123',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
        }),
      );
      expect(broker.deleteSession).toHaveBeenCalledWith('cxs_widget');

      const createConnectionResponse = await app.inject({
        method: 'POST',
        url: '/connections',
        payload: {
          widgetSessionId: 'wcws_123',
          title: 'Remote Codex',
          serverId: createdServer.id,
          remoteWorkspaceId: 'present',
        },
      });
      expect(createConnectionResponse.statusCode).toBe(201);
      expect(broker.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceSessionId: 'wcws_123',
          remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
          transport: {
            directTargetUrl: 'https://remote-codex.example/',
          },
        }),
      );
      const connectionPayload = createConnectionResponse.json() as {
        widgetSession: { id: string; connectionId: string };
        connection: { id: string; frameUrl: string };
      };
      expect(connectionPayload.connection.frameUrl).toContain('/sessions/cxs_widget/proxy/token/');
      expect(JSON.stringify(createConnectionResponse.json())).not.toContain('https://remote-codex.example');

      const serversResponse = await app.inject({ method: 'GET', url: '/servers' });
      expect(serversResponse.statusCode).toBe(200);
      expect(JSON.stringify(serversResponse.json())).not.toContain('directTargetUrl');

      const refreshConnectionResponse = await app.inject({
        method: 'GET',
        url: `/connections/${connectionPayload.connection.id}`,
      });
      expect(refreshConnectionResponse.statusCode).toBe(200);
      expect(broker.getSession).toHaveBeenCalledWith('cxs_widget');

      const snapshotResponse = await app.inject({
        method: 'GET',
        url: `/widgets/${connectionPayload.widgetSession.id}`,
      });
      expect(snapshotResponse.statusCode).toBe(200);
      expect(snapshotResponse.json()).toMatchObject({
        realtimeUrl: 'ws://127.0.0.1:4102/ws',
      });

      const deleteConnectionResponse = await app.inject({
        method: 'DELETE',
        url: `/connections/${connectionPayload.connection.id}`,
      });
      expect(deleteConnectionResponse.statusCode).toBe(200);
      expect(broker.deleteSession).toHaveBeenCalledWith('cxs_widget');
    } finally {
      await app.close();
    }
  });

  it('marks auth as expired when a verified auth probe fails with an auth-shaped broker error', async () => {
    const broker = {
      createSession: jest.fn().mockRejectedValue(new Error('401 unauthorized session expired')),
      getSession: jest.fn(),
      deleteSession: jest.fn(),
    };
    const service = new WidgetCodexService({
      stateFilePath,
      broker,
      defaultServers: [
        {
          id: 'wcsrv_expired',
          label: 'Expired Remote',
          description: null,
          authStrategy: 'external_url',
          authState: 'pending',
          authUrl: 'https://remote-codex.example/login',
          transport: {
            directTargetUrl: 'https://remote-codex.example/',
          },
          workspaces: [
            {
              id: 'present',
              label: 'PRESENT',
              path: '/srv/codex/repos/PRESENT',
            },
          ],
        },
      ],
    });
    const app = await buildWidgetCodexServer({ service });

    try {
      const authCompleteResponse = await app.inject({
        method: 'POST',
        url: '/servers/wcsrv_expired/auth/complete',
        payload: {
          remoteWorkspaceId: 'present',
        },
      });
      expect(authCompleteResponse.statusCode).toBe(400);

      const serversResponse = await app.inject({ method: 'GET', url: '/servers' });
      expect(serversResponse.json().servers[0].authState).toBe('expired');
    } finally {
      await app.close();
    }
  });

  it('fails fast when the state file path points at a directory', async () => {
    const directoryPath = path.join(os.tmpdir(), `present-widget-codex-dir-${Date.now()}`);
    await fs.mkdir(directoryPath, { recursive: true });
    const service = new WidgetCodexService({ stateFilePath: directoryPath });

    await expect(buildWidgetCodexServer({ service })).rejects.toThrow(/state file path points to a directory/i);
    await fs.rm(directoryPath, { recursive: true, force: true });
  });
});
