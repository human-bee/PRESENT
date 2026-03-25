import { fireEvent, render, screen } from '@testing-library/react';
import { ResetWorkspaceShell } from './reset-workspace-shell';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: jest.fn(),
  }),
}));

jest.mock('./reset-collaboration-surface', () => ({
  ResetCollaborationSurface: ({
    onSelectedRuntimeNodeChange,
  }: {
    onSelectedRuntimeNodeChange?: (nodeId: string | null) => void;
  }) => (
    <div>
      <div>Reset-native TLDraw collaboration</div>
      <button type="button" onClick={() => onSelectedRuntimeNodeChange?.('artifact:artifact_1')}>
        Select Runtime Artifact
      </button>
      <button type="button" onClick={() => onSelectedRuntimeNodeChange?.('widget:artifact_widget')}>
        Select Runtime Widget
      </button>
    </div>
  ),
}));

jest.mock('./reset-monaco-editor', () => ({
  ResetMonacoEditor: ({ initialValue }: { initialValue: string }) => <div>{initialValue}</div>,
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
            schemaVersion: 'canvas-os/v1',
            runtimeCenter: 'responses',
            primarySurface: 'canvas',
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
            connectors: [],
            resources: [],
            events: [],
            approvalPolicies: [],
            traceSchemaUri: 'present://schemas/trace-linkage',
            registry: {
              uri: 'present://runtime/registry',
              updatedAt: new Date().toISOString(),
              connectorCount: 0,
            },
            media: {
              provider: 'livekit',
              transport: 'webrtc',
              supports: ['audio', 'video', 'screen', 'data_channel'],
              roomIdTemplate: 'reset-{workspaceSessionId}',
            },
            collaboration: {
              livekitEnabled: true,
              canvasEnabled: true,
              widgetsEnabled: true,
              dualClient: true,
              canvasTransport: 'tldraw_sync',
              sharedDocTransport: 'yjs_ws',
              presenceTransport: 'webrtc',
              operatorSurfaces: ['canvas', 'shell', 'archive'],
              defaultRoomId: 'reset-ws_123',
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
          schemaVersion: 'canvas-os/v1',
          runtimeCenter: 'responses',
          primarySurface: 'canvas',
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
          connectors: [],
          resources: [],
          events: [],
          approvalPolicies: [],
          traceSchemaUri: 'present://schemas/trace-linkage',
          registry: {
            uri: 'present://runtime/registry',
            updatedAt: new Date().toISOString(),
            connectorCount: 0,
          },
          media: {
            provider: 'livekit',
            transport: 'webrtc',
            supports: ['audio', 'video', 'screen', 'data_channel'],
            roomIdTemplate: 'reset-{workspaceSessionId}',
          },
          collaboration: {
            livekitEnabled: true,
            canvasEnabled: true,
            widgetsEnabled: true,
            dualClient: true,
            canvasTransport: 'tldraw_sync',
            sharedDocTransport: 'yjs_ws',
            presenceTransport: 'webrtc',
            operatorSurfaces: ['canvas', 'shell', 'archive'],
            defaultRoomId: 'reset-ws_123',
          },
        }}
        initialRegistry={{
          generatedAt: new Date().toISOString(),
          workspaceSessionId: 'ws_123',
          roomId: 'reset-ws_123',
          connectors: [
            {
              id: 'codex-app-server',
              label: 'Codex App Server',
              lane: 'codex',
              transport: 'app_server',
              endpoint: 'http://127.0.0.1:4096',
              health: 'healthy',
              capabilities: ['code_edit'],
              metadata: {},
            },
          ],
          resources: [],
          events: [],
          approvalPolicies: [],
        }}
        initialAgentPack={{
          generatedAt: new Date().toISOString(),
          surface: 'canvas',
          workspaceSessionId: 'ws_123',
          workspacePath: '/tmp/present-reset',
          manifestUri: 'present://runtime/manifest',
          registryUri: 'present://runtime/registry',
          resourceUris: {
            manifest: 'present://runtime/manifest',
            registry: 'present://runtime/registry',
            canvasSession: 'present://canvas/session',
            workspace: 'present://workspaces/state',
            artifacts: 'present://artifacts/state',
            approvals: 'present://approvals/state',
            presence: 'present://presence/state',
            traces: 'present://traces/state',
            models: 'present://models/status',
          },
          eventUris: {
            taskStreamTemplate: '/api/reset/tasks/{taskId}/events',
            traces: '/api/reset/traces',
            presence: '/api/reset/presence',
            livekitCommentary: 'livekit:data-channel:reset-ws_123',
          },
          approvalUris: {
            state: 'present://approvals/state',
            resolve: '/api/reset/approvals',
          },
          roomId: 'reset-ws_123',
          mcpServer: {
            name: 'present-mcp',
            transport: 'stdio',
            command: 'npm',
            args: ['run', 'present:mcp'],
            cwd: process.cwd(),
            env: {
              PRESENT_RESET_WORKSPACE_SESSION_ID: 'ws_123',
            },
          },
          commands: {
            openWorkspace: {
              command: 'npm',
              args: ['run', 'fairy:cli', '--', 'reset', 'open', '--workspacePath', '/tmp/present-reset'],
              cwd: process.cwd(),
            },
            inspectWorkspace: {
              command: 'npm',
              args: ['run', 'fairy:cli', '--', 'reset', 'status', '--workspaceSessionId', 'ws_123'],
              cwd: process.cwd(),
            },
            startTurn: {
              command: 'npm',
              args: ['run', 'fairy:cli', '--', 'reset', 'turn', '--workspaceSessionId', 'ws_123', '--prompt', '<prompt>'],
              cwd: process.cwd(),
            },
            printManifest: {
              command: 'npm',
              args: ['run', 'fairy:cli', '--', 'reset', 'manifest', '--workspaceSessionId', 'ws_123'],
              cwd: process.cwd(),
            },
          },
          connectorHints: [
            {
              connectorId: 'codex-app-server',
              purpose: 'Primary coding lane.',
              preferWhen: 'You need code edits and artifacts.',
            },
          ],
          recommendedClients: ['OpenClaw', 'Codex desktop'],
          notes: ['ChatGPT auth remains local-companion only.'],
        }}
        initialCanvasSession={{
          generatedAt: new Date().toISOString(),
          schemaVersion: 'canvas-session/v1',
          boardMode: 'tldraw_native',
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
          room: {
            generatedAt: new Date().toISOString(),
            workspaceSessionId: 'ws_123',
            workspaceTitle: 'Reset Workspace',
            roomId: 'reset-ws_123',
            primarySurface: 'canvas',
            operatorSurfaces: ['canvas', 'shell', 'archive'],
            metadata: {},
          },
          activeTaskRunId: null,
          nodes: [
            {
              id: 'artifact:artifact_1',
              kind: 'artifact-card',
              syncVersion: 'artifact-sync-1',
              retention: 'persistent',
              layoutHint: {
                zone: 'center_stack',
                priority: 0,
                defaultSize: { w: 368, h: 220 },
              },
              artifactId: 'artifact_1',
              title: 'Patch README',
              mimeType: 'text/x-diff',
              metadata: {
                kind: 'file_patch',
                filePath: 'README.md',
                preview: 'diff --git a/README.md b/README.md',
              },
            },
            {
              id: 'widget:artifact_widget',
              kind: 'widget-frame',
              syncVersion: 'widget-sync-1',
              retention: 'persistent',
              layoutHint: {
                zone: 'center_stack',
                priority: 1,
                defaultSize: { w: 440, h: 336 },
              },
              title: 'Research Widget',
              artifactId: 'artifact_widget',
              artifactUri: '/api/reset/artifacts/artifact_widget?workspaceSessionId=ws_123',
              resourceUri: null,
              widgetRuntime: {
                hostKind: 'component',
                componentType: 'ResearchPanel',
                componentProps: {
                  title: 'Research Widget',
                  results: [],
                },
                resourceUri: null,
                serverName: null,
                toolName: null,
                args: null,
                displayMode: 'inline',
                contextKey: 'canvas',
              },
              bridgeState: {
                status: 'hydrating',
                resourceUri: null,
                lastHydratedAt: new Date().toISOString(),
                privatePayloadHash: null,
                metadata: {},
              },
              metadata: {
                kind: 'widget_bundle',
                componentType: 'ResearchPanel',
                hostKind: 'component',
              },
            },
          ],
          summary: {
            taskRuns: 0,
            widgets: 1,
            artifacts: 2,
            approvals: 0,
            pendingApprovals: 0,
            traceRails: 0,
            traceEvents: 0,
            participants: 0,
            mediaTiles: 0,
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

    expect(await screen.findByText(/Canvas OS for rooms, agents, widgets, and live code/i)).toBeTruthy();
    expect(await screen.findByText(/Shared Spatial Runtime/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Show Operator Dock/i }));
    expect(await screen.findByRole('button', { name: /Start Codex Turn/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Queue Canvas Task/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Create Patch Artifact/i })).toBeTruthy();
    expect(await screen.findByText(/Recent Sessions/i)).toBeTruthy();
    expect(await screen.findByText(/Canvas Interop Pack/i)).toBeTruthy();
    expect(await screen.findByText(/GenUI Dock/i)).toBeTruthy();
    expect((await screen.findAllByText('package.json')).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: /Select Runtime Artifact/i }));
    expect(await screen.findByText(/Board-Owned Runtime Object/i)).toBeTruthy();
    expect(await screen.findByText(/Patch README/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Select Runtime Widget/i }));
    expect(await screen.findByText(/ResearchPanel · hydrating/i)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Reload Widget/i })).toBeTruthy();
    expect((await screen.findByRole('button', { name: /Copy Resource URI/i })).hasAttribute('disabled')).toBe(true);
  }, 15000);
});
