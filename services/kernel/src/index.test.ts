import path from 'node:path';
import {
  buildRuntimeManifest,
  completeTaskRun,
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
    expect(buildRuntimeManifest().mcp.serverName).toBe('present-mcp');
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
});
