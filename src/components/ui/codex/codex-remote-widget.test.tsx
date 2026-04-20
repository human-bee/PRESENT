import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CodexRemoteWidget } from './codex-remote-widget';

const componentRegistryUpdateMock = jest.fn().mockResolvedValue(undefined);
const useComponentRegistrationMock = jest.fn();

jest.mock('@/lib/component-registry', () => ({
  ComponentRegistry: {
    update: (...args: unknown[]) => componentRegistryUpdateMock(...args),
  },
  useComponentRegistration: (...args: unknown[]) => useComponentRegistrationMock(...args),
}));

const buildServersPayload = () => ({
  realtimeUrl: null,
  servers: [
    {
      id: 'wcsrv_1',
      label: 'Remote Prod',
      description: 'Primary remote Codex app',
      authStrategy: 'none',
      authState: 'authenticated',
      authUrl: null,
      workspaces: [
        {
          id: 'present',
          label: 'PRESENT',
          path: '/srv/codex/repos/PRESENT',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
});

describe('CodexRemoteWidget', () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    componentRegistryUpdateMock.mockClear();
    useComponentRegistrationMock.mockClear();
    (global as any).WebSocket = undefined;
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/widget-codex/servers') {
        return {
          ok: true,
          json: async () => buildServersPayload(),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    (global as any).WebSocket = originalWebSocket;
  });

  it('loads the multi-server setup flow when no widget session exists yet', async () => {
    render(<CodexRemoteWidget title="Remote Codex" />);

    expect(await screen.findByText('Connect Remote Codex')).toBeTruthy();
    expect(await screen.findByText(/saved servers, login handoff/i)).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith('/api/widget-codex/servers', undefined);
    expect(screen.getByRole('option', { name: 'Remote Prod' })).toBeTruthy();
  });

  it('connects through the widget-codex api and persists the returned remote session state', async () => {
    const connectedSnapshot = {
      widgetSession: {
        id: 'wcws_123',
        title: 'Remote Codex',
        serverId: 'wcsrv_1',
        connectionId: 'wccx_123',
        remoteWorkspaceId: 'present',
        remoteWorkspacePath: '/srv/codex/repos/PRESENT',
        status: 'ready',
        authState: 'authenticated',
        activeThreadId: null,
        lastHeartbeatAt: '2026-04-20T22:00:00.000Z',
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      connection: {
        id: 'wccx_123',
        widgetSessionId: 'wcws_123',
        serverId: 'wcsrv_1',
        brokerSessionId: 'cxs_123',
        remoteWorkspaceId: 'present',
        remoteWorkspacePath: '/srv/codex/repos/PRESENT',
        frameUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/token/',
        proxyBaseUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/token',
        status: 'ready',
        authState: 'authenticated',
        lastHeartbeatAt: '2026-04-20T22:00:00.000Z',
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/widget-codex/servers') {
        return {
          ok: true,
          json: async () => buildServersPayload(),
        } as Response;
      }
      if (url === '/api/widget-codex/widgets/wcws_123') {
        return {
          ok: true,
          json: async () => ({
            realtimeUrl: null,
            servers: buildServersPayload().servers,
            ...connectedSnapshot,
          }),
        } as Response;
      }
      if (url === '/api/widget-codex/connections') {
        return {
          ok: true,
          json: async () => connectedSnapshot,
        } as Response;
      }
      if (url === '/api/reset/workspaces' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            workspace: {
              id: 'ws_widget_1',
              title: 'Widget wcws_123',
              workspacePath: '/Users/bsteinher/PRESENT',
            },
          }),
        } as Response;
      }
      if (url === '/api/reset/workspaces') {
        return {
          ok: true,
          json: async () => ({
            workspaces: [],
          }),
        } as Response;
      }
      if (url === '/api/reset/executors/register') {
        return {
          ok: true,
          json: async () => ({
            executorSession: {
              id: 'exec_widget_1',
            },
          }),
        } as Response;
      }
      if (url === '/api/reset/workspaces/ws_widget_1/state') {
        return {
          ok: true,
          json: async () => ({
            tasks: [],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<CodexRemoteWidget title="Remote Codex" />);

    await screen.findByRole('option', { name: 'Remote Prod' });
    fireEvent.click(screen.getByText('Connect Remote Codex'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/widget-codex/connections',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
    await waitFor(() => {
      expect(componentRegistryUpdateMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          widgetSessionId: 'wcws_123',
          connectionId: 'wccx_123',
          remoteSessionId: 'cxs_123',
          frameUrl: 'http://127.0.0.1:4101/sessions/cxs_123/proxy/token/',
          remoteWorkspacePath: '/srv/codex/repos/PRESENT',
        }),
      );
    });
  });

  it('starts auth inline for a login-required server', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/widget-codex/servers') {
        return {
          ok: true,
          json: async () => ({
            realtimeUrl: null,
            servers: [
              {
                ...buildServersPayload().servers[0],
                authStrategy: 'external_url',
                authState: 'login_required',
                authUrl: 'https://remote-codex.example/login',
              },
            ],
          }),
        } as Response;
      }
      if (url === '/api/widget-codex/servers/wcsrv_1/auth/start') {
        return {
          ok: true,
          json: async () => ({
            authState: 'pending',
            loginUrl: 'https://remote-codex.example/login',
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          realtimeUrl: null,
          servers: [
            {
              ...buildServersPayload().servers[0],
              authStrategy: 'external_url',
              authState: 'pending',
              authUrl: 'https://remote-codex.example/login',
            },
          ],
        }),
      } as Response;
    });

    render(<CodexRemoteWidget title="Remote Codex" />);

    await screen.findByRole('option', { name: 'Remote Prod' });
    fireEvent.click(screen.getByText('Open Login'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/widget-codex/servers/wcsrv_1/auth/start',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByTitle('Widget Codex Login')).toBeTruthy();
  });
});
