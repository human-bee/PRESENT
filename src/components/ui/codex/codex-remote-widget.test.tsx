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
      transportKind: 'direct',
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

    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
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
      },
    );

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

  it('verifies auth completion with the selected workspace instead of closing the helper blindly', async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/widget-codex/servers') {
          return {
            ok: true,
            json: async () => ({
              realtimeUrl: null,
              servers: [
                {
                  ...buildServersPayload().servers[0],
                  authStrategy: 'iframe',
                  authState: 'pending',
                  authUrl: 'https://remote-codex.example/login',
                },
              ],
            }),
          } as Response;
        }
        if (url === '/api/widget-codex/servers/wcsrv_1/auth/complete') {
          return {
            ok: true,
            json: async () => ({
              server: {
                ...buildServersPayload().servers[0],
                authStrategy: 'iframe',
                authState: 'authenticated',
                authUrl: 'https://remote-codex.example/login',
              },
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => buildServersPayload(),
        } as Response;
      },
    );

    render(<CodexRemoteWidget title="Remote Codex" />);

    await screen.findByRole('option', { name: 'Remote Prod' });
    fireEvent.click(screen.getByText('Close Login Helper'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/widget-codex/servers/wcsrv_1/auth/complete',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"remoteWorkspaceId":"present"'),
        }),
      );
    });
  });

  it('surfaces expired auth as a re-authentication state', async () => {
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
                authState: 'expired',
                authUrl: 'https://remote-codex.example/login',
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<CodexRemoteWidget title="Remote Codex" />);

    expect(await screen.findByText('Auth: Login Expired')).toBeTruthy();
    expect(screen.getByText('Open Login')).toBeTruthy();
  });

  it('creates an SSH-backed saved server from inside the widget', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url === '/api/widget-codex/servers' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              server: {
                ...buildServersPayload().servers[0],
                id: 'wcsrv_ssh',
                label: 'Tailnet Codex',
                transportKind: 'ssh',
              },
            }),
          } as Response;
        }
        if (url === '/api/widget-codex/servers') {
          return {
            ok: true,
            json: async () => ({
              realtimeUrl: null,
              servers: [],
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      },
    );

    render(<CodexRemoteWidget title="Remote Codex" />);

    await screen.findByText('Add Server');
    fireEvent.click(screen.getByText('Add Server'));
    fireEvent.change(screen.getByLabelText('Server Label'), { target: { value: 'Tailnet Codex' } });
    fireEvent.change(screen.getByLabelText('SSH Host'), {
      target: { value: 'codex-box.tailnet.example' },
    });
    fireEvent.change(screen.getByLabelText('SSH Username'), { target: { value: 'ubuntu' } });
    fireEvent.change(screen.getByLabelText('SSH Private Key'), {
      target: {
        value: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      },
    });
    fireEvent.change(screen.getByLabelText('Host Key SHA256'), {
      target: { value: 'SHA256:testHostKey1234567890' },
    });
    fireEvent.change(screen.getByLabelText('Workspaces'), {
      target: {
        value: 'PRESENT|/srv/codex/repos/PRESENT',
      },
    });
    fireEvent.click(screen.getByText('Create Server'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/widget-codex/servers',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
    const createRequest = requests.find(
      (request) => request.url === '/api/widget-codex/servers' && request.init?.method === 'POST',
    );
    expect(createRequest).toBeTruthy();
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      label: 'Tailnet Codex',
      transportKind: 'ssh',
      ssh: {
        host: 'codex-box.tailnet.example',
        username: 'ubuntu',
        remotePort: 8390,
        hostKeySha256: 'SHA256:testHostKey1234567890',
        privateKey: expect.stringContaining('OPENSSH PRIVATE KEY'),
      },
      workspaces: [
        {
          id: 'workspace-present',
          label: 'PRESENT',
          path: '/srv/codex/repos/PRESENT',
        },
      ],
    });
  });

  it('explains malformed SSH form input without posting the server', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/widget-codex/servers') {
        return {
          ok: true,
          json: async () => ({
            realtimeUrl: null,
            servers: [],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<CodexRemoteWidget title="Remote Codex" />);

    await screen.findByText('Add Server');
    fireEvent.click(screen.getByText('Add Server'));
    fireEvent.change(screen.getByLabelText('Server Label'), { target: { value: 'Tailnet Codex' } });
    fireEvent.change(screen.getByLabelText('SSH Host'), {
      target: { value: 'codex-box.tailnet.example' },
    });
    fireEvent.change(screen.getByLabelText('SSH Username'), { target: { value: 'ubuntu' } });
    fireEvent.change(screen.getByLabelText('SSH Private Key'), {
      target: {
        value: 'cat ~/.ssh/present_widget_codex',
      },
    });
    fireEvent.change(screen.getByLabelText('Host Key SHA256'), {
      target: { value: 'SHA256:testHostKey1234567890' },
    });
    fireEvent.change(screen.getByLabelText('Workspaces'), {
      target: {
        value: 'PRESENT|/Users/bsteinher/PRESENT',
      },
    });
    fireEvent.click(screen.getByText('Create Server'));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          'Run the command in Terminal and paste the output, not the command or path.',
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/widget-codex/servers',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('shows a clear authorization error when server creation is rejected', async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/widget-codex/servers' && init?.method === 'POST') {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'unauthorized' }),
          } as Response;
        }
        if (url === '/api/widget-codex/servers') {
          return {
            ok: true,
            json: async () => ({
              realtimeUrl: null,
              servers: [],
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      },
    );

    render(<CodexRemoteWidget title="Remote Codex" />);

    await screen.findByText('Add Server');
    fireEvent.click(screen.getByText('Add Server'));
    fireEvent.change(screen.getByLabelText('Server Label'), { target: { value: 'Tailnet Codex' } });
    fireEvent.change(screen.getByLabelText('SSH Host'), {
      target: { value: 'codex-box.tailnet.example' },
    });
    fireEvent.change(screen.getByLabelText('SSH Username'), { target: { value: 'ubuntu' } });
    fireEvent.change(screen.getByLabelText('SSH Private Key'), {
      target: {
        value: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      },
    });
    fireEvent.change(screen.getByLabelText('Host Key SHA256'), {
      target: { value: 'SHA256:testHostKey1234567890' },
    });
    fireEvent.change(screen.getByLabelText('Workspaces'), {
      target: {
        value: 'PRESENT|/Users/bsteinher/PRESENT',
      },
    });
    fireEvent.click(screen.getByText('Create Server'));

    expect(
      await screen.findByText(
        'You are not signed in or this browser session is not authorized to manage Widget Codex servers. Sign in with an allowlisted admin account, then retry.',
      ),
    ).toBeTruthy();
  });
});
