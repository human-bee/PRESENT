import type { CanvasSessionSnapshot } from '@present/contracts';
import { buildRuntimeShapeOperations, getRuntimeShapeId } from './use-canvas-runtime-shape-reconciler';

const baseSnapshot = (nodes: CanvasSessionSnapshot['nodes']): CanvasSessionSnapshot => ({
  generatedAt: '2026-03-25T12:00:00.000Z',
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
    createdAt: '2026-03-25T12:00:00.000Z',
    updatedAt: '2026-03-25T12:00:00.000Z',
    metadata: {},
  },
  room: {
    generatedAt: '2026-03-25T12:00:00.000Z',
    workspaceSessionId: 'ws_123',
    workspaceTitle: 'Reset Workspace',
    roomId: 'reset-ws_123',
    primarySurface: 'canvas',
    operatorSurfaces: ['canvas', 'shell'],
    metadata: {},
  },
  activeTaskRunId: 'task_123',
  nodes,
  summary: {
    taskRuns: 0,
    widgets: 0,
    artifacts: 0,
    approvals: 0,
    pendingApprovals: 0,
    traceRails: 0,
    traceEvents: 0,
    participants: 0,
    mediaTiles: 0,
  },
});

describe('buildRuntimeShapeOperations', () => {
  it('creates deterministic TLDraw runtime shapes from canvas session nodes', () => {
    const snapshot = baseSnapshot([
      {
        id: 'run:task_123',
        kind: 'run-lane',
        syncVersion: 'run-sync-1',
        retention: 'mirror',
        layoutHint: {
          zone: 'left_rail',
          priority: 0,
          defaultSize: { w: 292, h: 168 },
        },
        taskRunId: 'task_123',
        title: 'Codex turn',
        status: 'running',
        metadata: { taskType: 'codex.turn' },
      },
      {
        id: 'artifact:artifact_123',
        kind: 'artifact-card',
        syncVersion: 'artifact-sync-1',
        retention: 'persistent',
        layoutHint: {
          zone: 'center_stack',
          priority: 100,
          defaultSize: { w: 368, h: 220 },
        },
        artifactId: 'artifact_123',
        title: 'Patch README',
        mimeType: 'text/x-diff',
        metadata: { kind: 'file_patch', preview: 'diff --git a/README.md b/README.md' },
      },
      {
        id: 'widget:artifact_widget',
        kind: 'widget-frame',
        syncVersion: 'widget-sync-1',
        retention: 'persistent',
        layoutHint: {
          zone: 'center_stack',
          priority: 0,
          defaultSize: { w: 440, h: 336 },
        },
        title: 'Board Widget',
        artifactId: 'artifact_widget',
        artifactUri: '/api/reset/artifacts/artifact_widget?workspaceSessionId=ws_123',
        resourceUri: null,
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
        bridgeState: {
          status: 'hydrating',
          resourceUri: null,
          lastHydratedAt: '2026-03-25T12:00:00.000Z',
          privatePayloadHash: null,
          metadata: {},
        },
        metadata: { hostKind: 'component' },
      },
    ]);

    const operations = buildRuntimeShapeOperations(snapshot, []);

    expect(operations.update).toHaveLength(0);
    expect(operations.delete).toHaveLength(0);
    expect(operations.create).toHaveLength(3);
    expect(operations.create[0]).toMatchObject({
      id: getRuntimeShapeId('run:task_123'),
      type: 'runtime_card',
      x: -920,
      y: -420,
    });
    expect(operations.create[1]).toMatchObject({
      id: getRuntimeShapeId('artifact:artifact_123'),
      type: 'runtime_card',
      x: 120,
      y: -300,
    });
    expect(operations.create[2]).toMatchObject({
      id: getRuntimeShapeId('widget:artifact_widget'),
      type: 'runtime_widget',
      x: -300,
      y: -300,
    });
  });

  it('updates content props while preserving user-moved layout and size', () => {
    const snapshot = baseSnapshot([
      {
        id: 'run:task_123',
        kind: 'run-lane',
        syncVersion: 'run-sync-2',
        retention: 'mirror',
        layoutHint: {
          zone: 'left_rail',
          priority: 0,
          defaultSize: { w: 292, h: 168 },
        },
        taskRunId: 'task_123',
        title: 'Codex turn',
        status: 'succeeded',
        metadata: { taskType: 'codex.turn' },
      },
    ]);

    const operations = buildRuntimeShapeOperations(snapshot, [
      {
        id: getRuntimeShapeId('run:task_123'),
        type: 'runtime_card',
        x: 480,
        y: 120,
        rotation: 0,
        props: {
          w: 420,
          h: 240,
          nodeId: 'run:task_123',
          nodeKind: 'run-lane',
          syncVersion: 'run-sync-1',
          retention: 'mirror',
          title: 'Old title',
          subtitle: 'running',
          detail: 'codex.turn',
        },
      } as any,
    ]);

    expect(operations.create).toHaveLength(0);
    expect(operations.delete).toHaveLength(0);
    expect(operations.update).toEqual([
      {
        id: getRuntimeShapeId('run:task_123'),
        type: 'runtime_card',
        props: expect.objectContaining({
          w: 420,
          h: 240,
          syncVersion: 'run-sync-2',
          subtitle: 'succeeded',
        }),
      },
    ]);
  });

  it('deletes mirror shapes when nodes disappear but keeps persistent shapes', () => {
    const snapshot = baseSnapshot([]);

    const operations = buildRuntimeShapeOperations(snapshot, [
      {
        id: getRuntimeShapeId('run:task_123'),
        type: 'runtime_card',
        x: 0,
        y: 0,
        rotation: 0,
        props: {
          w: 292,
          h: 168,
          nodeId: 'run:task_123',
          nodeKind: 'run-lane',
          syncVersion: 'run-sync-1',
          retention: 'mirror',
          title: 'Codex turn',
        },
      } as any,
      {
        id: getRuntimeShapeId('artifact:artifact_123'),
        type: 'runtime_card',
        x: 0,
        y: 0,
        rotation: 0,
        props: {
          w: 368,
          h: 220,
          nodeId: 'artifact:artifact_123',
          nodeKind: 'artifact-card',
          syncVersion: 'artifact-sync-1',
          retention: 'persistent',
          title: 'Patch README',
        },
      } as any,
    ]);

    expect(operations.create).toHaveLength(0);
    expect(operations.update).toHaveLength(0);
    expect(operations.delete).toEqual([getRuntimeShapeId('run:task_123')]);
  });
});
