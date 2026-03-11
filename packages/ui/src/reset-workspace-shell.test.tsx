import { render, screen } from '@testing-library/react';
import { ResetWorkspaceShell } from './reset-workspace-shell';

class MockEventSource {
  close() {}
  addEventListener() {}
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
}

describe('ResetWorkspaceShell', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
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
    } as Response);

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
  });
});
