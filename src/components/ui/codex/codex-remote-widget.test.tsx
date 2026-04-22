import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CodexRemoteWidget, deriveWidgetCodexWsUrl } from './codex-remote-widget';

const componentRegistryUpdateMock = jest.fn().mockResolvedValue(undefined);
const useComponentRegistrationMock = jest.fn();
const fetchWithSupabaseAuthMock = jest.fn();

jest.mock('@/lib/component-registry', () => ({
  ComponentRegistry: {
    update: (...args: unknown[]) => componentRegistryUpdateMock(...args),
  },
  useComponentRegistration: (...args: unknown[]) => useComponentRegistrationMock(...args),
}));

jest.mock('@/lib/supabase/auth-headers', () => ({
  fetchWithSupabaseAuth: (...args: unknown[]) => fetchWithSupabaseAuthMock(...args),
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
    fetchWithSupabaseAuthMock.mockClear();
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
    fetchWithSupabaseAuthMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, init),
    );
  });

  afterEach(() => {
    (global as any).WebSocket = originalWebSocket;
  });

  it('upgrades insecure widget websocket urls when the canvas is served over https', () => {
    expect(
      deriveWidgetCodexWsUrl(
        'ws://present-widget-codex-production.up.railway.app/ws',
        'https://app.present.best/canvas',
      ),
    ).toBe('wss://present-widget-codex-production.up.railway.app/ws');
    expect(deriveWidgetCodexWsUrl('/ws', 'https://app.present.best/canvas')).toBe(
      'wss://app.present.best/ws',
    );
  });

  it('keeps one websocket subscription alive across snapshot state updates', async () => {
    type Listener = (event: { data?: string }) => void;
    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      listeners = new Map<string, Listener[]>();
      sent: string[] = [];
      url: string;

      constructor(url: string | URL) {
        this.url = String(url);
        MockWebSocket.instances.push(this);
      }

      addEventListener(type: string, listener: Listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }

      send(message: string) {
        this.sent.push(message);
      }

      close() {
        this.listeners.get('close')?.forEach((listener) => listener({}));
      }

      emit(type: string, event: { data?: string }) {
        this.listeners.get(type)?.forEach((listener) => listener(event));
      }
    }

    (global as any).WebSocket = MockWebSocket;
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/widget-codex/servers') {
        return {
          ok: true,
          json: async () => ({
            realtimeUrl: 'wss://present-widget-codex-production.up.railway.app/ws',
            servers: buildServersPayload().servers,
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<CodexRemoteWidget title="Remote Codex" />);

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const emitSnapshot = async (socket: MockWebSocket) => {
      await act(async () => {
        socket.emit('message', {
          data: JSON.stringify({
            type: 'snapshot',
            payload: {
              realtimeUrl: 'wss://present-widget-codex-production.up.railway.app/ws',
              servers: buildServersPayload().servers,
              widgetSession: {
                id: 'wcws_live',
                title: 'Remote Codex',
                serverId: 'wcsrv_1',
                connectionId: null,
                remoteWorkspaceId: 'present',
                remoteWorkspacePath: '/srv/codex/repos/PRESENT',
                status: 'disconnected',
                authState: 'authenticated',
                activeThreadId: null,
                lastHeartbeatAt: null,
                lastError: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              connection: null,
            },
          }),
        });
      });
    };

    await emitSnapshot(MockWebSocket.instances[0]);

    await waitFor(() => {
      expect(componentRegistryUpdateMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          widgetSessionId: 'wcws_live',
        }),
      );
    });
    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    await emitSnapshot(MockWebSocket.instances[1]);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('loads the multi-server setup flow when no widget session exists yet', async () => {
    render(<CodexRemoteWidget title="Remote Codex" />);

    expect(await screen.findByText('Connect Remote Codex')).toBeTruthy();
    expect(await screen.findByText(/saved servers, login handoff/i)).toBeTruthy();
    expect(fetchWithSupabaseAuthMock).toHaveBeenCalledWith('/api/widget-codex/servers', undefined);
    expect(global.fetch).toHaveBeenCalledWith('/api/widget-codex/servers', undefined);
    expect(screen.getByRole('option', { name: 'Remote Prod' })).toBeTruthy();
  });

  it('does not crash when the server list omits workspaces', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/widget-codex/servers') {
        return {
          ok: true,
          json: async () => ({
            realtimeUrl: null,
            servers: [
              {
                id: 'wcsrv_partial',
                label: 'Partial Server',
                authStrategy: 'none',
                authState: 'authenticated',
                transportKind: 'ssh',
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

    expect(await screen.findByText('Connect Remote Codex')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Partial Server' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'No workspaces yet' })).toBeTruthy();
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

  it('recovers a stale reset workspace binding before sending a native turn', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        fetchCalls.push({ url, init });

        if (url === '/api/widget-codex/servers') {
          return {
            ok: true,
            json: async () => buildServersPayload(),
          } as Response;
        }
        if (url === '/api/reset/workspaces/ws_stale/state') {
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'Workspace session not found' }),
          } as Response;
        }
        if (url === '/api/reset/workspaces' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              workspace: {
                id: 'ws_recovered',
                title: 'Widget wcws_recover',
                workspacePath: '/srv/codex/repos/PRESENT',
              },
            }),
          } as Response;
        }
        if (url === '/api/reset/workspaces') {
          return {
            ok: true,
            json: async () => ({ workspaces: [] }),
          } as Response;
        }
        if (url === '/api/reset/executors/register') {
          return {
            ok: true,
            json: async () => ({
              executorSession: {
                id: 'exec_recovered',
              },
            }),
          } as Response;
        }
        if (url === '/api/reset/turns' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              taskRun: {
                id: 'task_recovered',
                status: 'queued',
                summary: 'can you see this message?',
                createdAt: '2026-04-22T22:00:00.000Z',
                updatedAt: '2026-04-22T22:00:00.000Z',
                startedAt: null,
                completedAt: null,
                error: null,
                result: null,
                metadata: {},
              },
            }),
          } as Response;
        }
        if (url === '/api/reset/workspaces/ws_recovered/state') {
          return {
            ok: true,
            json: async () => ({ tasks: [] }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      },
    );

    render(
      <CodexRemoteWidget
        title="Remote Codex"
        state={{
          title: 'Remote Codex',
          frameUrl: 'https://present-codex-broker-production.up.railway.app/sessions/cxs/proxy/token/',
          widgetSessionId: 'wcws_recover',
          workspaceSessionId: 'ws_stale',
          executorSessionId: 'exec_stale',
          connectionId: 'wccx_recover',
          remoteSessionId: 'cxs_recover',
          serverId: 'wcsrv_1',
          remoteWorkspaceId: 'present',
          remoteWorkspacePath: '/srv/codex/repos/PRESENT',
          status: 'ready',
          authState: 'authenticated',
        }}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        'Ask Remote Codex to inspect, edit, review, or run something in the selected remote workspace.',
      ),
      { target: { value: 'can you see this message?' } },
    );
    fireEvent.click(screen.getByText('Send Turn'));

    await waitFor(() => {
      const turnRequest = fetchCalls.find((call) => call.url === '/api/reset/turns');
      expect(turnRequest).toBeTruthy();
      expect(JSON.parse(String(turnRequest?.init?.body))).toEqual(
        expect.objectContaining({
          workspaceSessionId: 'ws_recovered',
          executorSessionId: 'exec_recovered',
          prompt: 'can you see this message?',
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

  it('explains backend DNS failures when connecting to a tailnet host the service cannot resolve', async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/widget-codex/connections' && init?.method === 'POST') {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: '{"error":"getaddrinfo ENOTFOUND bens-macbook-pro.tailb3d6e9.ts.net"}',
            }),
          } as Response;
        }
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
      },
    );

    render(<CodexRemoteWidget title="Remote Codex" />);

    await screen.findByRole('option', { name: 'Remote Prod' });
    fireEvent.click(screen.getByText('Connect Remote Codex'));

    expect(
      await screen.findByText(/Cannot resolve SSH host bens-macbook-pro\.tailb3d6e9\.ts\.net/),
    ).toBeTruthy();
  });

  it('normalizes raw persisted backend error JSON before rendering it', async () => {
    render(
      <CodexRemoteWidget
        title="Remote Codex"
        state={{
          title: 'Remote Codex',
          serverId: 'wcsrv_1',
          remoteWorkspaceId: 'present',
          remoteWorkspacePath: '/Users/bsteinher/PRESENT',
          status: 'error',
          authState: 'authenticated',
          lastError: '{"error":"getaddrinfo ENOTFOUND bens-macbook-pro.tailb3d6e9.ts.net"}',
        }}
      />,
    );

    expect(
      await screen.findByText(/Cannot resolve SSH host bens-macbook-pro\.tailb3d6e9\.ts\.net/),
    ).toBeTruthy();
    expect(screen.queryByText(/^\{"error":/)).toBeNull();
  });
});
