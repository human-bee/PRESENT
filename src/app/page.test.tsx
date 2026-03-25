import { render, screen } from '@testing-library/react';
import Home from './page';

const ensureResetKernelHydratedMock = jest.fn();
const getWorkspaceSessionMock = jest.fn();
const listWorkspaceSessionsMock = jest.fn();
const openWorkspaceSessionMock = jest.fn();
const listArtifactsMock = jest.fn();
const createArtifactMock = jest.fn();
const buildCanvasRuntimeSurfaceMock = jest.fn();
const resolveKernelModelProfilesMock = jest.fn();
const listExecutorSessionsMock = jest.fn();
const listApprovalRequestsMock = jest.fn();
const listPresenceMembersMock = jest.fn();
const listTaskRunsMock = jest.fn();
const listTraceEventsMock = jest.fn();

jest.mock('@present/ui', () => ({
  ResetWorkspaceShell: () => <div data-testid="reset-workspace-shell">reset-workspace-shell</div>,
}));

jest.mock('@present/kernel', () => ({
  ensureResetKernelHydrated: (...args: unknown[]) => ensureResetKernelHydratedMock(...args),
  getWorkspaceSession: (...args: unknown[]) => getWorkspaceSessionMock(...args),
  listWorkspaceSessions: (...args: unknown[]) => listWorkspaceSessionsMock(...args),
  openWorkspaceSession: (...args: unknown[]) => openWorkspaceSessionMock(...args),
  listArtifacts: (...args: unknown[]) => listArtifactsMock(...args),
  createArtifact: (...args: unknown[]) => createArtifactMock(...args),
  buildCanvasRuntimeSurface: (...args: unknown[]) => buildCanvasRuntimeSurfaceMock(...args),
  resolveKernelModelProfiles: (...args: unknown[]) => resolveKernelModelProfilesMock(...args),
  listExecutorSessions: (...args: unknown[]) => listExecutorSessionsMock(...args),
  listApprovalRequests: (...args: unknown[]) => listApprovalRequestsMock(...args),
  listPresenceMembers: (...args: unknown[]) => listPresenceMembersMock(...args),
  listTaskRuns: (...args: unknown[]) => listTaskRunsMock(...args),
  listTraceEvents: (...args: unknown[]) => listTraceEventsMock(...args),
}));

describe('home page invite handling', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    ensureResetKernelHydratedMock.mockResolvedValue(undefined);
    getWorkspaceSessionMock.mockReturnValue(null);
    listWorkspaceSessionsMock.mockReturnValue([]);
    openWorkspaceSessionMock.mockReturnValue({
      id: 'ws_local',
      workspacePath: '/tmp/present-reset',
      branch: 'codex/reset',
      title: 'Reset Workspace',
      state: 'active',
      ownerUserId: null,
      activeExecutorSessionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    });
    listArtifactsMock.mockReturnValue([]);
    buildCanvasRuntimeSurfaceMock.mockReturnValue({
      manifest: {
        generatedAt: new Date().toISOString(),
        schemaVersion: 'canvas-os/v1',
        runtimeCenter: 'responses',
        primarySurface: 'canvas',
        codex: {
          appServerBaseUrl: 'http://127.0.0.1:4096',
          authModes: ['chatgpt'],
          recommendedModels: ['gpt-5.4'],
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
          supports: ['audio'],
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
          operatorSurfaces: ['canvas'],
          defaultRoomId: 'reset-ws_local',
        },
      },
      registry: { generatedAt: new Date().toISOString(), workspaceSessionId: 'ws_local', roomId: 'reset-ws_local', connectors: [], resources: [], events: [], approvalPolicies: [] },
      agentPack: {
        generatedAt: new Date().toISOString(),
        surface: 'canvas',
        workspaceSessionId: 'ws_local',
        workspacePath: '/tmp/present-reset',
        manifestUri: 'present://runtime/manifest',
        registryUri: 'present://runtime/registry',
        resourceUris: {
          manifest: 'present://runtime/manifest',
          registry: 'present://runtime/registry',
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
          livekitCommentary: 'livekit:data-channel:reset-ws_local',
        },
        approvalUris: {
          state: 'present://approvals/state',
          resolve: '/api/reset/approvals',
        },
        roomId: 'reset-ws_local',
        mcpServer: {
          name: 'present-mcp',
          transport: 'stdio',
          command: 'npm',
          args: ['run', 'present:mcp'],
          cwd: process.cwd(),
          env: {},
        },
        commands: {
          openWorkspace: { command: 'npm', args: ['run'], cwd: process.cwd() },
          inspectWorkspace: { command: 'npm', args: ['run'], cwd: process.cwd() },
          startTurn: { command: 'npm', args: ['run'], cwd: process.cwd() },
          printManifest: { command: 'npm', args: ['run'], cwd: process.cwd() },
        },
        connectorHints: [],
        recommendedClients: ['Codex desktop'],
        notes: [],
      },
    });
    resolveKernelModelProfilesMock.mockResolvedValue([]);
    listExecutorSessionsMock.mockReturnValue([]);
    listApprovalRequestsMock.mockReturnValue([]);
    listPresenceMembersMock.mockReturnValue([]);
    listTaskRunsMock.mockReturnValue([]);
    listTraceEventsMock.mockReturnValue([]);
  });

  it('fails closed when a requested workspace session is missing', async () => {
    render(
      await Home({
        searchParams: Promise.resolve({
          workspace: 'ws_missing',
        }),
      }),
    );

    expect(screen.getByText(/Invite Could Not Be Resolved/i)).toBeTruthy();
    expect(screen.queryByTestId('reset-workspace-shell')).toBeNull();
    expect(openWorkspaceSessionMock).not.toHaveBeenCalled();
  });
});
