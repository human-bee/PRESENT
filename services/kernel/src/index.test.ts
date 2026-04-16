import path from 'node:path';
import {
  buildAgentInteropPack,
  buildCanvasRuntimeSurface,
  buildConnectorRegistrySnapshot,
  buildRuntimeManifest,
  completeTaskRun,
  consumeApprovalRequest,
  createApprovalRequest,
  createArtifact,
  createTraceId,
  createTaskRun,
  listApprovalRequests,
  listArtifacts,
  listTaskRuns,
  listTraceEvents,
  openWorkspaceSession,
  resetKernelStateForTests,
  resolveApprovalRequest,
} from '@present/kernel';

describe('reset kernel', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-kernel-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
  });

  it('opens workspaces and creates server-owned widget artifacts', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-${Date.now()}`,
      title: 'Kernel Test',
      branch: 'codex/reset',
    });

    const artifact = createArtifact({
      workspaceSessionId: workspace.id,
      kind: 'widget_bundle',
      title: 'Widget',
      mimeType: 'text/html',
      content: '<html><body>widget</body></html>',
    });

    expect(listArtifacts(workspace.id).some((entry) => entry.id === artifact.id)).toBe(true);
    expect(artifact.metadata['widgetRuntime']).toEqual(
      expect.objectContaining({
        hostKind: 'html_bundle',
        displayMode: 'inline',
      }),
    );
  });

  it('records approval events into the trace ledger', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-trace-${Date.now()}`,
      title: 'Approval Test',
      branch: 'codex/reset',
    });
    const traceId = createTraceId();

    const approval = createApprovalRequest({
      workspaceSessionId: workspace.id,
      traceId,
      kind: 'git_action',
      title: 'Approve branch mutation',
      detail: 'Allow a reset-era write.',
      requestedBy: 'jest',
    });

    expect(listApprovalRequests(workspace.id).some((entry) => entry.id === approval.id)).toBe(true);
    expect(listTraceEvents(traceId).some((event) => event.type === 'approval.requested')).toBe(true);
    expect(buildRuntimeManifest().mcp.serverName).toBe('present-mcp');
    expect(buildRuntimeManifest(workspace).primarySurface).toBe('canvas');
  });

  it('persists task lifecycle across kernel reads', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-task-${Date.now()}`,
      title: 'Task Test',
      branch: 'codex/reset',
    });

    const taskRun = createTaskRun({
      workspaceSessionId: workspace.id,
      summary: 'Run codex turn',
      taskType: 'codex.turn',
    });

    completeTaskRun(taskRun.id, {
      finalResponse: 'done',
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
    });

    const persisted = listTaskRuns(workspace.id);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.status).toBe('succeeded');
    expect(persisted[0]?.result?.['finalResponse']).toBe('done');
  });

  it('builds a BYO-agent interop pack for external clients', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-interop-${Date.now()}`,
      title: 'Interop Test',
      branch: 'codex/reset',
    });

    const pack = buildAgentInteropPack(workspace);
    const registry = buildConnectorRegistrySnapshot(workspace);

    expect(pack.workspaceSessionId).toBe(workspace.id);
    expect(pack.mcpServer.name).toBe('present-mcp');
    expect(pack.recommendedClients).toContain('OpenClaw');
    expect(pack.commands.startTurn.args).toContain('--prompt');
    expect(pack.roomId).toBe(registry.roomId);
    expect(buildRuntimeManifest(workspace).media.roomIdTemplate.replace('{workspaceSessionId}', workspace.id)).toBe(pack.roomId);
    expect(registry.connectors.some((connector) => connector.id === 'codex-app-server')).toBe(true);
  });

  it('builds one consistent runtime snapshot per workspace', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-runtime-surface-${Date.now()}`,
      title: 'Runtime Surface Test',
      branch: 'codex/reset',
    });

    const surface = buildCanvasRuntimeSurface(workspace);

    expect(surface.manifest.generatedAt).toBe(surface.registry.generatedAt);
    expect(surface.agentPack.generatedAt).toBe(surface.registry.generatedAt);
    expect(surface.agentPack.roomId).toBe(surface.manifest.collaboration.defaultRoomId);
  });

  it('does not allow consumed approvals to be re-approved', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-approval-guard-${Date.now()}`,
      title: 'Approval Guard Test',
      branch: 'codex/reset',
    });
    const traceId = createTraceId();

    const approval = createApprovalRequest({
      workspaceSessionId: workspace.id,
      traceId,
      kind: 'git_action',
      title: 'Approve patch apply',
      detail: 'Allow one patch apply.',
      requestedBy: 'jest',
    });

    const approved = resolveApprovalRequest({
      approvalRequestId: approval.id,
      state: 'approved',
      resolvedBy: 'jest',
    });

    expect(approved?.state).toBe('approved');

    const consumed = consumeApprovalRequest({
      approvalRequestId: approval.id,
      workspaceSessionId: workspace.id,
      resolvedBy: 'jest',
    });

    expect(consumed.state).toBe('expired');
    expect(() =>
      resolveApprovalRequest({
        approvalRequestId: approval.id,
        state: 'approved',
        resolvedBy: 'jest',
      }),
    ).toThrow('Approval request can only be resolved while pending');
  });
});
