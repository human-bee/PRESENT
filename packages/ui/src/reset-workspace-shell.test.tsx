import { render, screen } from '@testing-library/react';
import { ResetWorkspaceShell } from './reset-workspace-shell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: jest.fn(),
  }),
}));

class MockEventSource {
  close() {}
  addEventListener() {}
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
}

describe('ResetWorkspaceShell', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/reset/workspaces/ws_123/files')) {
        return {
          ok: true,
          json: async () => ({
            files: [
              {
                path: 'package.json',
                name: 'package.json',
                kind: 'file',
                size: 120,
                updatedAt: new Date().toISOString(),
                language: 'json',
              },
            ],
          }),
          text: async () => '',
        } as Response;
      }

      if (url.includes('/api/reset/workspaces/ws_123/file?')) {
        return {
          ok: true,
          json: async () => ({
            document: {
              path: 'package.json',
              name: 'package.json',
              kind: 'file',
              size: 120,
              updatedAt: new Date().toISOString(),
              language: 'json',
              content: '{ "name": "present" }',
            },
          }),
          text: async () => '',
        } as Response;
      }

      if (url.includes('/api/reset/presence')) {
        return {
          ok: true,
          json: async () => ({
            presenceMember: {
              id: 'presence_123',
              workspaceSessionId: 'ws_123',
              identity: 'operator-test',
              displayName: 'Mission TEST',
              state: 'connected',
              media: {
                audio: false,
                video: false,
                screen: false,
              },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              metadata: {
                activeFilePath: 'package.json',
                editorMode: 'reset_shell',
                draftSyncEnabled: false,
              },
            },
          }),
          text: async () => '',
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          workspace: {
            id: 'ws_123',
            workspacePath: '/tmp/present-reset',
            branch: 'codex/reset',
            title: 'Reset Workspace',
            state: 'active',
            ownerUserId: null,
            activeExecutorSessionId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {},
          },
          executors: [],
          tasks: [],
          artifacts: [],
          approvals: [],
          presence: [],
          traces: [],
          modelProfiles: [],
          manifest: {
            generatedAt: new Date().toISOString(),
            codex: {
              appServerBaseUrl: 'http://127.0.0.1:4096',
              authModes: ['chatgpt', 'api_key', 'shared_key', 'byok'],
              recommendedModels: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
            },
            mcp: {
              serverName: 'present-mcp',
              transport: 'stdio',
              command: ['npm', 'run', 'present:mcp'],
            },
            collaboration: {
              livekitEnabled: true,
              canvasEnabled: true,
              widgetsEnabled: true,
              dualClient: true,
            },
          },
        }),
        text: async () => '',
      } as Response;
    });

    Object.defineProperty(global, 'EventSource', {
      writable: true,
      value: MockEventSource,
    });
  });

  it('renders the reset workspace shell headline and turn controls', async () => {
    render(
      <ResetWorkspaceShell
        initialManifest={{
          generatedAt: new Date().toISOString(),
          codex: {
            appServerBaseUrl: 'http://127.0.0.1:4096',
            authModes: ['chatgpt', 'api_key', 'shared_key', 'byok'],
            recommendedModels: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
          },
          mcp: {
            serverName: 'present-mcp',
            transport: 'stdio',
            command: ['npm', 'run', 'present:mcp'],
          },
          collaboration: {
            livekitEnabled: true,
            canvasEnabled: true,
            widgetsEnabled: true,
            dualClient: true,
          },
        }}
        initialWorkspace={{
          id: 'ws_123',
          workspacePath: '/tmp/present-reset',
          branch: 'codex/reset',
          title: 'Reset Workspace',
          state: 'active',
          ownerUserId: null,
          activeExecutorSessionId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        }}
        initialWorkspaces={[
          {
            id: 'ws_123',
            workspacePath: '/tmp/present-reset',
            branch: 'codex/reset',
            title: 'Reset Workspace',
            state: 'active',
            ownerUserId: null,
            activeExecutorSessionId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {},
          },
        ]}
        initialExecutors={[]}
        initialTasks={[]}
        initialArtifacts={[]}
        initialApprovals={[]}
        initialPresence={[]}
        initialModelProfiles={[]}
        initialTraceEvents={[]}
      />,
    );

    expect(await screen.findByText(/Editorial mission control/i)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Start Codex Turn/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Queue Canvas Task/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Create Patch Artifact/i })).toBeTruthy();
    expect(await screen.findByText(/Recent Sessions/i)).toBeTruthy();
    expect((await screen.findAllByText('package.json')).length).toBeGreaterThan(0);
  });
});
