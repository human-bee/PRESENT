import {
  canvasEventDescriptorSchema,
  canvasResourceDescriptorSchema,
  connectorDescriptorSchema,
  connectorRegistrySnapshotSchema,
  approvalPolicySchema,
  createCanvasRoomId,
  type WorkspaceSession,
} from '@present/contracts';

const getOpenClawEndpoint = () => process.env.OPENCLAW_ACP_URL ?? process.env.OPENCLAW_PLUGIN_URL ?? null;
export { createCanvasRoomId } from '@present/contracts';

const buildConnectorDescriptors = () => {
  const codexAppServerBaseUrl = process.env.CODEX_APP_SERVER_URL ?? 'http://127.0.0.1:4096';
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LK_SERVER_URL ?? null;
  const tldrawSyncUrl = process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL ?? null;
  const openClawEndpoint = getOpenClawEndpoint();

  return [
    connectorDescriptorSchema.parse({
      id: 'codex-app-server',
      label: 'Codex App Server',
      lane: 'codex',
      transport: 'app_server',
      endpoint: codexAppServerBaseUrl,
      health: 'healthy',
      capabilities: ['code_edit', 'code_review', 'widget_render', 'mcp_client'],
      metadata: {
        priority: 'primary',
      },
    }),
    connectorDescriptorSchema.parse({
      id: 'present-mcp',
      label: 'PRESENT MCP',
      lane: 'widget',
      transport: 'mcp',
      endpoint: null,
      health: 'healthy',
      capabilities: ['mcp_server', 'workspace_state', 'artifact_state', 'approval_state', 'trace_state'],
      metadata: {
        transport: 'stdio',
      },
    }),
    connectorDescriptorSchema.parse({
      id: 'livekit-room',
      label: 'LiveKit Realtime',
      lane: 'media',
      transport: 'webrtc',
      endpoint: livekitUrl,
      health: livekitUrl ? 'healthy' : 'degraded',
      capabilities: ['audio', 'video', 'screen', 'data_channel', 'room_presence'],
    }),
    connectorDescriptorSchema.parse({
      id: 'tldraw-sync',
      label: 'TLDraw Sync',
      lane: 'canvas',
      transport: 'websocket',
      endpoint: tldrawSyncUrl,
      health: tldrawSyncUrl ? 'healthy' : 'degraded',
      capabilities: ['canvas_edit', 'canvas_sync'],
    }),
    connectorDescriptorSchema.parse({
      id: 'yjs-collaboration',
      label: 'Yjs Collaboration',
      lane: 'coding',
      transport: 'yjs',
      endpoint: null,
      health: 'healthy',
      capabilities: ['shared_docs', 'monaco_sync'],
    }),
    connectorDescriptorSchema.parse({
      id: 'openclaw-acp',
      label: 'OpenClaw ACP Adapter',
      lane: 'openclaw',
      transport: 'acp',
      endpoint: openClawEndpoint,
      health: openClawEndpoint ? 'healthy' : 'offline',
      capabilities: ['external_runtime', 'plugin_bridge', 'byo_agent'],
      metadata: {
        priority: 'secondary',
      },
    }),
  ];
};

export const buildRuntimeResourceDescriptors = () =>
  [
    ['runtime.manifest', 'present://runtime/manifest', 'Runtime Manifest', 'manifest'],
    ['runtime.registry', 'present://runtime/registry', 'Connector Registry', 'registry'],
    ['runtime.interop', 'present://runtime/interop', 'Canvas Interop Pack', 'manifest'],
    ['workspace.state', 'present://workspaces/state', 'Workspace Sessions', 'workspace'],
    ['executor.state', 'present://executors/state', 'Executor Sessions', 'workspace'],
    ['task.state', 'present://tasks/state', 'Task Runs', 'trace'],
    ['artifact.state', 'present://artifacts/state', 'Artifacts', 'artifact'],
    ['workspace.files', 'present://workspace/files', 'Workspace Files', 'workspace'],
    ['artifact.diff', 'present://artifact/diff', 'Artifact Diff', 'artifact'],
    ['approval.state', 'present://approvals/state', 'Approval State', 'approval'],
    ['presence.state', 'present://presence/state', 'Presence State', 'presence'],
    ['trace.state', 'present://traces/state', 'Trace State', 'trace'],
    ['model.status', 'present://models/status', 'Model Status', 'model'],
  ].map(([id, uri, label, kind]) =>
    canvasResourceDescriptorSchema.parse({
      id,
      uri,
      label,
      kind,
      modelVisible: kind !== 'registry',
    }),
  );

export const buildRuntimeEventDescriptors = (roomId: string | null) => [
  canvasEventDescriptorSchema.parse({
    id: 'task.stream',
    channel: '/api/reset/tasks/{taskId}/events',
    label: 'Task Event Stream',
    transport: 'sse',
    durable: false,
  }),
  canvasEventDescriptorSchema.parse({
    id: 'trace.search',
    channel: '/api/reset/traces',
    label: 'Trace Search',
    transport: 'webhook',
    durable: true,
  }),
  canvasEventDescriptorSchema.parse({
    id: 'presence.upsert',
    channel: '/api/reset/presence',
    label: 'Presence Upsert',
    transport: 'webhook',
    durable: true,
  }),
  canvasEventDescriptorSchema.parse({
    id: 'livekit.commentary',
    channel: roomId ? `livekit:data-channel:${roomId}` : 'livekit:data-channel:{roomId}',
    label: 'LiveKit Commentary',
    transport: 'data_channel',
    durable: false,
  }),
];

export const buildApprovalPolicies = () => [
  approvalPolicySchema.parse({
    id: 'approval.file_write',
    kind: 'file_write',
    label: 'Patch and file writes require explicit approval.',
    defaultTtlSeconds: 900,
  }),
  approvalPolicySchema.parse({
    id: 'approval.git_action',
    kind: 'git_action',
    label: 'Git mutations require a single-use approval token.',
    defaultTtlSeconds: 900,
  }),
  approvalPolicySchema.parse({
    id: 'approval.network_access',
    kind: 'network_access',
    label: 'External network access requires a bounded escalation token.',
    defaultTtlSeconds: 600,
  }),
];

export function buildConnectorRegistrySnapshot(
  workspace: WorkspaceSession | null = null,
  options: { generatedAt?: string } = {},
) {
  const roomId = workspace ? createCanvasRoomId(workspace.id) : null;
  return connectorRegistrySnapshotSchema.parse({
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    workspaceSessionId: workspace?.id ?? null,
    roomId,
    connectors: buildConnectorDescriptors(),
    resources: buildRuntimeResourceDescriptors(),
    events: buildRuntimeEventDescriptors(roomId),
    approvalPolicies: buildApprovalPolicies(),
  });
}
