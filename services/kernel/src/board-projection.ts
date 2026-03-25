import { createHash } from 'node:crypto';
import {
  canvasSessionSnapshotSchema,
  resolveCanvasRoomId,
  type CanvasNodeLayoutHint,
  type ApprovalRequest,
  type Artifact,
  type CanvasSessionSnapshot,
  type KernelEvent,
  type PresenceMember,
  type TaskRun,
  type WidgetRuntimeEnvelope,
  type WorkspaceSession,
} from '@present/contracts';
import { listApprovalRequests } from './approvals';
import { listArtifacts, resolveArtifactWidgetRuntime } from './artifacts';
import { listPresenceMembers } from './presence';
import { buildCanvasRuntimeSurface, type CanvasRuntimeSurface } from './runtime-surface';
import { listTaskRuns } from './tasks';
import { listTraceEvents } from './traces';
import { getWorkspaceSession } from './workspace-sessions';

export type CanvasSessionSnapshotOptions = {
  activeTaskRunId?: string | null;
  generatedAt?: string;
  runtimeSurface?: CanvasRuntimeSurface;
  traceLimit?: number;
  traceQuery?: string;
};

const tracePreviewLimit = 3;
const livePresenceStates = new Set<PresenceMember['state']>(['connected', 'idle', 'away']);

const resolveSeatState = (state: PresenceMember['state']) => {
  switch (state) {
    case 'connected':
      return 'active' as const;
    case 'idle':
      return 'idle' as const;
    case 'away':
      return 'waiting' as const;
    default:
      return 'offline' as const;
  }
};

const resolveEventTitle = (event: KernelEvent) => {
  if ('title' in event) return event.title;
  if ('summary' in event) return event.summary;
  if ('toolName' in event) return event.toolName;
  if ('command' in event) return event.command;
  return 'Kernel event';
};

const resolveEventDetail = (event: KernelEvent) => {
  if ('detail' in event) return event.detail;
  if ('output' in event) return event.output;
  return null;
};

const buildSyncVersion = (parts: unknown) =>
  createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);

const buildLayoutHint = (
  zone: CanvasNodeLayoutHint['zone'],
  priority: number,
  defaultSize: CanvasNodeLayoutHint['defaultSize'],
  pinned = false,
): CanvasNodeLayoutHint => ({
  zone,
  priority,
  defaultSize,
  pinned,
});

const buildAgentSeats = (presence: PresenceMember[]) =>
  presence.map((member, index) => ({
    id: `seat:${member.id}`,
    kind: 'agent-seat' as const,
    syncVersion: buildSyncVersion({
      kind: 'agent-seat',
      id: member.id,
      state: member.state,
      updatedAt: member.updatedAt,
      media: member.media,
      roomName: member.metadata?.['roomName'] ?? null,
    }),
    retention: 'mirror' as const,
    layoutHint: buildLayoutHint('top_strip', index, { w: 220, h: 128 }, true),
    label: member.displayName,
    participantIdentity: member.identity,
    connectorId: typeof member.metadata?.['connectorId'] === 'string' ? (member.metadata['connectorId'] as string) : null,
    state: resolveSeatState(member.state),
    metadata: {
      presenceState: member.state,
      media: member.media,
      updatedAt: member.updatedAt,
      roomName: member.metadata?.['roomName'] ?? null,
    },
  }));

const buildMediaTiles = (presence: PresenceMember[]) =>
  presence
    .filter((member) => member.media.audio || member.media.video || member.media.screen)
    .map((member, index) => ({
      id: `media:${member.id}`,
      kind: 'media-tile' as const,
      syncVersion: buildSyncVersion({
        kind: 'media-tile',
        id: member.id,
        updatedAt: member.updatedAt,
        media: member.media,
        state: member.state,
      }),
      retention: 'mirror' as const,
      layoutHint: buildLayoutHint('top_strip', 100 + index, { w: 280, h: 176 }, true),
      participantIdentity: member.identity,
      media: member.media,
      metadata: {
        label: member.displayName,
        presenceState: member.state,
      },
    }));

const buildRunNodes = (tasks: TaskRun[]) =>
  tasks.map((task, index) => ({
    id: `run:${task.id}`,
    kind: 'run-lane' as const,
    syncVersion: buildSyncVersion({
      kind: 'run-lane',
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
      result: task.result,
      error: task.error,
    }),
    retention: 'mirror' as const,
    layoutHint: buildLayoutHint('left_rail', index, { w: 292, h: 168 }),
    taskRunId: task.id,
    title: task.summary,
    status: task.status,
    metadata: {
      taskType: task.taskType,
      traceId: task.traceId,
      updatedAt: task.updatedAt,
      result: task.result,
      error: task.error,
    },
  }));

const buildWidgetArtifactUri = (artifact: Artifact) =>
  `/api/reset/artifacts/${encodeURIComponent(artifact.id)}?workspaceSessionId=${encodeURIComponent(artifact.workspaceSessionId)}`;

const resolveWidgetRuntime = (artifact: Artifact): WidgetRuntimeEnvelope =>
  resolveArtifactWidgetRuntime({
    content: artifact.content,
    metadata: artifact.metadata,
  }) ?? {
    hostKind: 'html_bundle',
    componentType: null,
    componentProps: {},
    resourceUri: null,
    serverName: null,
    toolName: null,
    args: null,
    displayMode: 'inline',
    contextKey: 'canvas',
  };

const buildWidgetNodes = (artifacts: Artifact[]) =>
  artifacts
    .filter((artifact) => artifact.kind === 'widget_bundle')
    .map((artifact, index) => {
      const widgetRuntime = resolveWidgetRuntime(artifact);
      const artifactUri = buildWidgetArtifactUri(artifact);
      return {
        id: `widget:${artifact.id}`,
        kind: 'widget-frame' as const,
        syncVersion: buildSyncVersion({
          kind: 'widget-frame',
          id: artifact.id,
          updatedAt: artifact.updatedAt,
          title: artifact.title,
          mimeType: artifact.mimeType,
          widgetRuntime,
        }),
        retention: 'persistent' as const,
        layoutHint: buildLayoutHint('center_stack', index, { w: 440, h: 336 }),
        title: artifact.title,
        artifactId: artifact.id,
        artifactUri,
        resourceUri: widgetRuntime.resourceUri,
        widgetRuntime,
        bridgeState: {
          status:
            widgetRuntime.hostKind === 'html_bundle'
              ? artifact.content.trim()
                ? 'ready'
                : 'idle'
              : 'hydrating',
          resourceUri: widgetRuntime.resourceUri,
          lastHydratedAt: artifact.updatedAt,
          privatePayloadHash: null,
          metadata: {
            mimeType: artifact.mimeType,
            hostKind: widgetRuntime.hostKind,
            artifactUri,
          },
        },
        metadata: {
          traceId: artifact.traceId,
          kind: artifact.kind,
          mimeType: artifact.mimeType,
          updatedAt: artifact.updatedAt,
          componentType: widgetRuntime.componentType,
          hostKind: widgetRuntime.hostKind,
          artifactUri,
        },
      };
    });

const buildArtifactNodes = (artifacts: Artifact[]) =>
  artifacts
    .filter((artifact) => artifact.kind !== 'widget_bundle')
    .map((artifact, index) => ({
      id: `artifact:${artifact.id}`,
      kind: 'artifact-card' as const,
      syncVersion: buildSyncVersion({
        kind: 'artifact-card',
        id: artifact.id,
        updatedAt: artifact.updatedAt,
        title: artifact.title,
        mimeType: artifact.mimeType,
        traceId: artifact.traceId,
      }),
      retention: 'persistent' as const,
      layoutHint: buildLayoutHint('center_stack', 100 + index, { w: 368, h: 220 }),
      artifactId: artifact.id,
      title: artifact.title,
      mimeType: artifact.mimeType,
      metadata: {
        kind: artifact.kind,
        traceId: artifact.traceId,
        updatedAt: artifact.updatedAt,
        preview: artifact.content.slice(0, 240),
        ...artifact.metadata,
      },
    }));

const buildApprovalNodes = (approvals: ApprovalRequest[]) =>
  approvals.map((approval, index) => ({
    id: `approval:${approval.id}`,
    kind: 'approval-chip' as const,
    syncVersion: buildSyncVersion({
      kind: 'approval-chip',
      id: approval.id,
      state: approval.state,
      updatedAt: approval.updatedAt,
      expiresAt: approval.expiresAt,
    }),
    retention: 'mirror' as const,
    layoutHint: buildLayoutHint('right_stack', index, { w: 320, h: 188 }),
    approvalRequestId: approval.id,
    title: approval.title,
    detail: approval.detail,
    state: approval.state,
    metadata: {
      kind: approval.kind,
      traceId: approval.traceId,
      taskRunId: approval.taskRunId,
      requestedBy: approval.requestedBy,
      expiresAt: approval.expiresAt,
      updatedAt: approval.updatedAt,
    },
  }));

const buildTraceRails = (events: KernelEvent[]) => {
  const grouped = new Map<string, KernelEvent[]>();
  for (const event of events) {
    const group = grouped.get(event.traceId);
    if (group) {
      group.push(event);
    } else {
      grouped.set(event.traceId, [event]);
    }
  }

  return Array.from(grouped.entries())
    .map(([traceId, traceEvents]) => {
      const ordered = [...traceEvents].sort((left, right) => right.emittedAt.localeCompare(left.emittedAt));
      const latest = ordered[0] ?? null;
      return {
        id: `trace:${traceId}`,
        kind: 'trace-rail' as const,
        syncVersion: buildSyncVersion({
          kind: 'trace-rail',
          traceId,
          latestEventAt: latest?.emittedAt ?? null,
          latestEventType: latest?.type ?? null,
          eventCount: ordered.length,
        }),
        retention: 'mirror' as const,
        layoutHint: buildLayoutHint('bottom_strip', 0, { w: 360, h: 176 }, true),
        traceId,
        title: latest ? resolveEventTitle(latest) : `Trace ${traceId.slice(-6)}`,
        eventCount: ordered.length,
        latestEventAt: latest?.emittedAt ?? null,
        latestEventType: latest?.type ?? null,
        metadata: {
          preview: ordered.slice(0, tracePreviewLimit).map((event) => ({
            id: event.id,
            type: event.type,
            title: resolveEventTitle(event),
            detail: resolveEventDetail(event),
            emittedAt: event.emittedAt,
          })),
        },
      };
    })
    .sort((left, right) => {
      const leftStamp = left.latestEventAt ?? '';
      const rightStamp = right.latestEventAt ?? '';
      return rightStamp.localeCompare(leftStamp);
    })
    .map((traceRail, index) => ({
      ...traceRail,
      layoutHint: buildLayoutHint('bottom_strip', index, traceRail.layoutHint.defaultSize, true),
    }));
};

const buildTraceWindow = (workspaceSessionId: string, options: CanvasSessionSnapshotOptions) => {
  return listTraceEvents({
    workspaceSessionId,
    limit: options.traceLimit ?? 24,
  });
};

export function buildCanvasSessionSnapshot(
  workspace: WorkspaceSession,
  options: CanvasSessionSnapshotOptions = {},
): CanvasSessionSnapshot {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runtimeSurface = options.runtimeSurface ?? buildCanvasRuntimeSurface(workspace);
  const tasks = listTaskRuns(workspace.id);
  const artifacts = listArtifacts(workspace.id);
  const approvals = listApprovalRequests(workspace.id);
  const presence = listPresenceMembers(workspace.id);
  const livePresence = presence.filter((member) => livePresenceStates.has(member.state));
  const traces = buildTraceWindow(workspace.id, options);
  const roomId = resolveCanvasRoomId({
    workspaceSessionId: workspace.id,
    preferredRoomId:
      runtimeSurface.agentPack.roomId ??
      runtimeSurface.registry.roomId ??
      runtimeSurface.manifest.collaboration.defaultRoomId,
  });

  const nodes = [
    ...buildAgentSeats(livePresence),
    ...buildMediaTiles(livePresence),
    ...buildRunNodes(tasks),
    ...buildWidgetNodes(artifacts),
    ...buildArtifactNodes(artifacts),
    ...buildApprovalNodes(approvals),
    ...buildTraceRails(traces),
  ];

  return canvasSessionSnapshotSchema.parse({
    generatedAt,
    schemaVersion: 'canvas-session/v1',
    boardMode: 'tldraw_native',
    workspace,
    room: {
      generatedAt,
      workspaceSessionId: workspace.id,
      workspaceTitle: workspace.title,
      roomId,
      primarySurface: 'canvas',
      operatorSurfaces: runtimeSurface.manifest.collaboration.operatorSurfaces,
      metadata: {
        connectorCount: runtimeSurface.registry.connectors.length,
        registryUpdatedAt: runtimeSurface.registry.generatedAt,
      },
    },
    activeTaskRunId: options.activeTaskRunId ?? tasks[0]?.id ?? null,
    nodes,
    summary: {
      taskRuns: tasks.length,
      widgets: artifacts.filter((artifact) => artifact.kind === 'widget_bundle').length,
      artifacts: artifacts.length,
      approvals: approvals.length,
      pendingApprovals: approvals.filter((approval) => approval.state === 'pending').length,
      traceRails: nodes.filter((node) => node.kind === 'trace-rail').length,
      traceEvents: traces.length,
      participants: livePresence.length,
      mediaTiles: nodes.filter((node) => node.kind === 'media-tile').length,
    },
  });
}

export function getCanvasSessionSnapshot(
  workspaceSessionId: string,
  options: CanvasSessionSnapshotOptions = {},
): CanvasSessionSnapshot | null {
  const workspace = getWorkspaceSession(workspaceSessionId);
  if (!workspace) {
    return null;
  }
  return buildCanvasSessionSnapshot(workspace, options);
}
