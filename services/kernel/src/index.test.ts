import path from 'node:path';
import fs from 'node:fs';
import {
  buildAgentInteropPack,
  buildRuntimeManifest,
  completeTaskRun,
  createApprovalRequest,
  createArtifact,
  createTraceId,
  createTaskRun,
  getWorkspaceStateSnapshot,
  listApprovalRequests,
  listArtifacts,
  listExecutorSessions,
  listPresenceMembers,
  listTaskRuns,
  listTraceEvents,
  listWorkspaceTraceEvents,
  openWorkspaceSession,
  recordKernelEvent,
  resetKernelStateForTests,
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
    expect(listWorkspaceTraceEvents(workspace.id).map((event) => event.id)).toEqual([
      expect.stringMatching(/^evt_/),
    ]);
    expect(buildRuntimeManifest().mcp.serverName).toBe('present-mcp');
  });

  it('lists only workspace-scoped trace events in newest-first order', () => {
    const firstWorkspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-trace-first-${Date.now()}`,
      title: 'Trace First',
      branch: 'codex/reset',
    });
    const secondWorkspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-trace-second-${Date.now()}`,
      title: 'Trace Second',
      branch: 'codex/reset',
    });

    recordKernelEvent({
      id: 'evt_first_workspace_older',
      type: 'approval.requested',
      workspaceSessionId: firstWorkspace.id,
      traceId: createTraceId(),
      approvalRequestId: 'approval_first_older',
      state: 'pending',
      summary: 'Older first workspace event',
      metadata: { emittedAt: 'old' },
      emittedAt: '2026-01-01T00:00:00.000Z',
    });
    recordKernelEvent({
      id: 'evt_second_workspace',
      type: 'approval.requested',
      workspaceSessionId: secondWorkspace.id,
      traceId: createTraceId(),
      approvalRequestId: 'approval_second',
      state: 'pending',
      summary: 'Other workspace event',
      emittedAt: '2026-01-01T00:01:00.000Z',
    });
    recordKernelEvent({
      id: 'evt_first_workspace_newer',
      type: 'approval.requested',
      workspaceSessionId: firstWorkspace.id,
      traceId: createTraceId(),
      approvalRequestId: 'approval_first_newer',
      state: 'pending',
      summary: 'Newer first workspace event',
      metadata: { emittedAt: 'new' },
      emittedAt: '2026-01-01T00:02:00.000Z',
    });

    const scopedEvents = listWorkspaceTraceEvents(firstWorkspace.id);

    expect(scopedEvents).toHaveLength(2);
    expect(scopedEvents.map((event) => event.workspaceSessionId)).toEqual([
      firstWorkspace.id,
      firstWorkspace.id,
    ]);
    expect(scopedEvents[0]?.summary).toBe('Newer first workspace event');
    expect(scopedEvents[1]?.summary).toBe('Older first workspace event');
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

  it('builds workspace snapshots with the same scoped collection contracts as selectors', async () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-snapshot-${Date.now()}`,
      title: 'Snapshot Test',
      branch: 'codex/reset',
    });
    const otherWorkspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-snapshot-other-${Date.now()}`,
      title: 'Other Snapshot Test',
      branch: 'codex/reset',
    });

    createTaskRun({
      workspaceSessionId: workspace.id,
      summary: 'Run codex turn',
      taskType: 'codex.turn',
    });
    createTaskRun({
      workspaceSessionId: otherWorkspace.id,
      summary: 'Other codex turn',
      taskType: 'codex.turn',
    });
    createArtifact({
      workspaceSessionId: workspace.id,
      kind: 'widget_bundle',
      title: 'Snapshot Widget',
      mimeType: 'text/html',
      content: '<html></html>',
    });
    createApprovalRequest({
      workspaceSessionId: workspace.id,
      traceId: createTraceId(),
      kind: 'git_action',
      title: 'Snapshot approval',
      detail: 'Approve',
      requestedBy: 'jest',
    });

    const snapshot = await getWorkspaceStateSnapshot(workspace.id);

    expect(snapshot?.workspace.id).toBe(workspace.id);
    expect(snapshot?.tasks).toEqual(listTaskRuns(workspace.id));
    expect(snapshot?.artifacts).toEqual(listArtifacts(workspace.id));
    expect(snapshot?.approvals).toEqual(listApprovalRequests(workspace.id));
    expect(snapshot?.executors).toEqual(listExecutorSessions(workspace.id));
    expect(snapshot?.presence).toEqual(listPresenceMembers(workspace.id));
    expect(snapshot?.traces).toEqual(listWorkspaceTraceEvents(workspace.id));
    expect(snapshot?.tasks.map((task) => task.workspaceSessionId)).toEqual([workspace.id]);
  });

  it('reads persisted state once when building a workspace snapshot', async () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-snapshot-read-count-${Date.now()}`,
      title: 'Snapshot Read Count',
      branch: 'codex/reset',
    });
    createTaskRun({
      workspaceSessionId: workspace.id,
      summary: 'Run codex turn',
      taskType: 'codex.turn',
    });
    createArtifact({
      workspaceSessionId: workspace.id,
      kind: 'widget_bundle',
      title: 'Read Count Widget',
      mimeType: 'text/html',
      content: '<html></html>',
    });
    createApprovalRequest({
      workspaceSessionId: workspace.id,
      traceId: createTraceId(),
      kind: 'git_action',
      title: 'Read count approval',
      detail: 'Approve',
      requestedBy: 'jest',
    });

    const readSpy = jest.spyOn(fs, 'readFileSync');

    await getWorkspaceStateSnapshot(workspace.id);

    expect(
      readSpy.mock.calls.filter((call) => call[0] === process.env.PRESENT_RESET_STATE_PATH),
    ).toHaveLength(1);

    readSpy.mockRestore();
  });

  it('builds a BYO-agent interop pack for external clients', () => {
    const workspace = openWorkspaceSession({
      workspacePath: `/tmp/present-reset-interop-${Date.now()}`,
      title: 'Interop Test',
      branch: 'codex/reset',
    });

    const pack = buildAgentInteropPack(workspace);

    expect(pack.workspaceSessionId).toBe(workspace.id);
    expect(pack.mcpServer.name).toBe('present-mcp');
    expect(pack.recommendedClients).toContain('OpenClaw');
    expect(pack.commands.startTurn.args).toContain('--prompt');
  });
});
