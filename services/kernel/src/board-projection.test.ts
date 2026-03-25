import path from 'node:path';
import {
  buildCanvasSessionSnapshot,
  createApprovalRequest,
  createArtifact,
  createTaskRun,
  openWorkspaceSession,
  recordKernelEvent,
  resetKernelStateForTests,
  upsertPresenceMember,
} from '@present/kernel';

describe('board projection', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-board-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
  });

  it('projects runs, widgets, approvals, presence, and traces into a canvas session snapshot', () => {
    const workspace = openWorkspaceSession({
      workspacePath: process.cwd(),
      title: 'Board Projection',
      branch: 'codex/reset',
    });

    const task = createTaskRun({
      workspaceSessionId: workspace.id,
      summary: 'Build board overlay',
      taskType: 'codex.turn',
      traceId: 'trace_board',
      status: 'running',
    });

    createArtifact({
      workspaceSessionId: workspace.id,
      traceId: task.traceId,
      kind: 'widget_bundle',
      title: 'Board Widget',
      mimeType: 'application/json',
      metadata: {
        widgetRuntime: {
          hostKind: 'component',
          componentType: 'ResearchPanel',
          componentProps: {
            title: 'Board Widget',
            results: [],
          },
          resourceUri: null,
          serverName: null,
          toolName: null,
          args: null,
          displayMode: 'inline',
          contextKey: 'canvas',
        },
      },
    });

    createArtifact({
      workspaceSessionId: workspace.id,
      traceId: task.traceId,
      kind: 'file_patch',
      title: 'Patch README',
      mimeType: 'text/x-diff',
      content: 'diff --git a/README.md b/README.md',
      metadata: {
        filePath: 'README.md',
      },
    });

    createApprovalRequest({
      workspaceSessionId: workspace.id,
      traceId: task.traceId,
      taskRunId: task.id,
      kind: 'file_write',
      title: 'Approve README patch',
      detail: 'Allow patch application',
      requestedBy: 'codex',
    });

    upsertPresenceMember({
      workspaceSessionId: workspace.id,
      identity: 'operator-1',
      displayName: 'Mission OP1',
      state: 'connected',
      media: {
        audio: true,
        video: false,
        screen: true,
      },
      metadata: {
        connectorId: 'livekit-room',
      },
    });

    upsertPresenceMember({
      workspaceSessionId: workspace.id,
      identity: 'operator-offline',
      displayName: 'Mission Offline',
      state: 'offline',
      media: {
        audio: false,
        video: false,
        screen: false,
      },
      metadata: {},
    });

    recordKernelEvent({
      id: 'evt_board_1',
      type: 'turn.started',
      traceId: task.traceId,
      workspaceSessionId: workspace.id,
      emittedAt: '2026-03-25T12:00:00.000Z',
      taskRunId: task.id,
      title: 'Build board overlay',
      detail: null,
      metadata: {},
    });

    const snapshot = buildCanvasSessionSnapshot(workspace, {
      traceLimit: 12,
    });

    const runNode = snapshot.nodes.find((node) => node.kind === 'run-lane');
    const widgetNode = snapshot.nodes.find((node) => node.kind === 'widget-frame');
    const approvalNode = snapshot.nodes.find((node) => node.kind === 'approval-chip');
    const traceNode = snapshot.nodes.find((node) => node.kind === 'trace-rail');

    expect(snapshot.boardMode).toBe('tldraw_native');
    expect(snapshot.room.roomId).toBe(`reset-${workspace.id}`);
    expect(snapshot.summary.taskRuns).toBe(1);
    expect(snapshot.summary.widgets).toBe(1);
    expect(snapshot.summary.pendingApprovals).toBe(1);
    expect(snapshot.summary.participants).toBe(1);
    expect(snapshot.nodes.some((node) => node.kind === 'agent-seat' && node.participantIdentity === 'operator-offline')).toBe(false);
    expect(snapshot.nodes.some((node) => node.kind === 'run-lane')).toBe(true);
    expect(snapshot.nodes.some((node) => node.kind === 'widget-frame')).toBe(true);
    expect(snapshot.nodes.some((node) => node.kind === 'artifact-card')).toBe(true);
    expect(snapshot.nodes.some((node) => node.kind === 'approval-chip')).toBe(true);
    expect(snapshot.nodes.some((node) => node.kind === 'agent-seat')).toBe(true);
    expect(snapshot.nodes.some((node) => node.kind === 'media-tile')).toBe(true);
    expect(snapshot.nodes.some((node) => node.kind === 'trace-rail')).toBe(true);
    expect(runNode?.retention).toBe('mirror');
    expect(runNode?.layoutHint.zone).toBe('left_rail');
    expect(runNode?.syncVersion).toHaveLength(12);
    expect(widgetNode?.retention).toBe('persistent');
    expect(widgetNode?.layoutHint.zone).toBe('center_stack');
    expect(widgetNode?.widgetRuntime.hostKind).toBe('component');
    expect(widgetNode?.widgetRuntime.componentType).toBe('ResearchPanel');
    expect(widgetNode?.artifactUri).toBe(`/api/reset/artifacts/${widgetNode?.artifactId}?workspaceSessionId=${workspace.id}`);
    expect(widgetNode?.resourceUri).toBeNull();
    expect(widgetNode?.bridgeState.status).toBe('hydrating');
    expect(widgetNode?.metadata['html']).toBeUndefined();
    expect(approvalNode?.layoutHint.zone).toBe('right_stack');
    expect(traceNode?.layoutHint.zone).toBe('bottom_strip');
  });

  it('falls back to html bundle widgets for legacy artifacts without widgetRuntime metadata', () => {
    const workspace = openWorkspaceSession({
      workspacePath: process.cwd(),
      title: 'Legacy Widget Projection',
      branch: 'codex/reset',
    });

    createArtifact({
      workspaceSessionId: workspace.id,
      kind: 'widget_bundle',
      title: 'Legacy HTML Widget',
      mimeType: 'text/html',
      content: '<html><body>legacy</body></html>',
    });

    const snapshot = buildCanvasSessionSnapshot(workspace);
    const widgetNode = snapshot.nodes.find((node) => node.kind === 'widget-frame');

    expect(widgetNode?.widgetRuntime.hostKind).toBe('html_bundle');
    expect(widgetNode?.artifactUri).toBe(`/api/reset/artifacts/${widgetNode?.artifactId}?workspaceSessionId=${workspace.id}`);
    expect(widgetNode?.resourceUri).toBeNull();
    expect(widgetNode?.metadata['html']).toBeUndefined();
  });
});
