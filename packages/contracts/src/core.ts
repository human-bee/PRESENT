import { z } from 'zod';

export const isoDateTimeSchema = z.string().min(1);
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const workspaceSessionStateSchema = z.enum(['active', 'idle', 'archived']);
export const executorSessionStateSchema = z.enum(['ready', 'busy', 'offline']);
export const taskRunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']);
export const artifactKindSchema = z.enum([
  'file_patch',
  'command_output',
  'widget_bundle',
  'canvas_snapshot',
  'trace_export',
  'review_report',
]);
export const approvalKindSchema = z.enum([
  'file_write',
  'shell_exec',
  'network_access',
  'git_action',
  'tool_escalation',
]);
export const approvalStateSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);
export const presenceStateSchema = z.enum(['connected', 'idle', 'away', 'offline']);
export const modelRoleSchema = z.enum([
  'planner',
  'executor',
  'reviewer',
  'search',
  'widget',
  'realtime',
  'app_server',
]);
export const modelSourceSchema = z.enum(['default', 'control_plane', 'byok', 'shared_key', 'request']);
export const executorKindSchema = z.enum(['local_companion', 'hosted_executor', 'room_worker', 'browser_client']);
export const sessionCapabilitySchema = z.enum([
  'code_edit',
  'code_review',
  'canvas_edit',
  'widget_render',
  'room_presence',
  'voice_realtime',
  'mcp_server',
  'mcp_client',
]);
export const connectorHealthSchema = z.enum(['healthy', 'degraded', 'offline']);
export const connectorLaneSchema = z.enum(['codex', 'openclaw', 'canvas', 'media', 'widget', 'research', 'coding']);
export const connectorTransportSchema = z.enum(['app_server', 'mcp', 'acp', 'webrtc', 'websocket', 'yjs']);
export const canvasResourceKindSchema = z.enum([
  'manifest',
  'registry',
  'workspace',
  'artifact',
  'approval',
  'trace',
  'presence',
  'widget',
  'model',
]);
export const eventTransportSchema = z.enum(['sse', 'data_channel', 'websocket', 'webhook']);
export const canvasNodeKindSchema = z.enum([
  'agent-seat',
  'widget-frame',
  'artifact-card',
  'run-lane',
  'media-tile',
  'approval-chip',
  'trace-rail',
]);

export const connectorDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  lane: connectorLaneSchema,
  transport: connectorTransportSchema,
  endpoint: z.string().min(1).nullable(),
  health: connectorHealthSchema.default('healthy'),
  capabilities: z.array(z.string().min(1)).default([]),
  metadata: jsonObjectSchema.default({}),
});

export const canvasResourceDescriptorSchema = z.object({
  id: z.string().min(1),
  uri: z.string().min(1),
  label: z.string().min(1),
  kind: canvasResourceKindSchema,
  modelVisible: z.boolean().default(true),
  metadata: jsonObjectSchema.default({}),
});

export const canvasEventDescriptorSchema = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
  label: z.string().min(1),
  transport: eventTransportSchema,
  durable: z.boolean().default(false),
  metadata: jsonObjectSchema.default({}),
});

export const approvalPolicySchema = z.object({
  id: z.string().min(1),
  kind: approvalKindSchema,
  label: z.string().min(1),
  requiresSingleUseToken: z.boolean().default(true),
  defaultTtlSeconds: z.number().int().positive().nullable().default(900),
  metadata: jsonObjectSchema.default({}),
});

export const manifestRegistrySchema = z.object({
  uri: z.string().min(1),
  updatedAt: isoDateTimeSchema,
  connectorCount: z.number().int().nonnegative().default(0),
});

export const mediaRuntimeSchema = z.object({
  provider: z.enum(['livekit']).default('livekit'),
  transport: z.enum(['webrtc']).default('webrtc'),
  supports: z
    .array(z.enum(['audio', 'video', 'screen', 'data_channel']))
    .default(['audio', 'video', 'screen', 'data_channel']),
  roomIdTemplate: z.string().min(1).default('reset-{workspaceSessionId}'),
});

export const collaborationRuntimeSchema = z.object({
  livekitEnabled: z.boolean(),
  canvasEnabled: z.boolean(),
  widgetsEnabled: z.boolean(),
  dualClient: z.boolean(),
  canvasTransport: z.enum(['tldraw_sync', 'yjs_ws']).default('tldraw_sync'),
  sharedDocTransport: z.enum(['yjs_ws']).default('yjs_ws'),
  presenceTransport: z.enum(['webrtc', 'websocket']).default('webrtc'),
  operatorSurfaces: z.array(z.enum(['canvas', 'shell', 'admin', 'archive'])).default(['canvas', 'shell', 'archive']),
  defaultRoomId: z.string().min(1).nullable().default(null),
});

export const connectorRegistrySnapshotSchema = z.object({
  generatedAt: isoDateTimeSchema,
  workspaceSessionId: z.string().min(1).nullable(),
  roomId: z.string().min(1).nullable(),
  connectors: z.array(connectorDescriptorSchema).default([]),
  resources: z.array(canvasResourceDescriptorSchema).default([]),
  events: z.array(canvasEventDescriptorSchema).default([]),
  approvalPolicies: z.array(approvalPolicySchema).default([]),
});

export const widgetBridgeStateSchema = z.object({
  status: z.enum(['idle', 'hydrating', 'ready', 'errored']).default('idle'),
  resourceUri: z.string().min(1).nullable().default(null),
  lastHydratedAt: isoDateTimeSchema.nullable().default(null),
  privatePayloadHash: z.string().min(1).nullable().default(null),
  metadata: jsonObjectSchema.default({}),
});

export const traceLinkageSchema = z.object({
  traceId: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  taskRunId: z.string().min(1).nullable().default(null),
  artifactId: z.string().min(1).nullable().default(null),
  approvalRequestId: z.string().min(1).nullable().default(null),
  connectorId: z.string().min(1).nullable().default(null),
  roomId: z.string().min(1).nullable().default(null),
  metadata: jsonObjectSchema.default({}),
});

export const agentSeatSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('agent-seat'),
  label: z.string().min(1),
  participantIdentity: z.string().min(1).nullable().default(null),
  connectorId: z.string().min(1).nullable().default(null),
  state: z.enum(['active', 'idle', 'waiting', 'offline']).default('idle'),
  metadata: jsonObjectSchema.default({}),
});

export const widgetInstanceSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('widget-frame'),
  title: z.string().min(1),
  artifactId: z.string().min(1).nullable().default(null),
  resourceUri: z.string().min(1).nullable().default(null),
  bridgeState: widgetBridgeStateSchema.default({
    status: 'idle',
    resourceUri: null,
    lastHydratedAt: null,
    privatePayloadHash: null,
    metadata: {},
  }),
  metadata: jsonObjectSchema.default({}),
});

export const artifactNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('artifact-card'),
  artifactId: z.string().min(1),
  title: z.string().min(1),
  mimeType: z.string().min(1),
  metadata: jsonObjectSchema.default({}),
});

export const runNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('run-lane'),
  taskRunId: z.string().min(1),
  title: z.string().min(1),
  status: taskRunStatusSchema,
  metadata: jsonObjectSchema.default({}),
});

export const mediaTileSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('media-tile'),
  participantIdentity: z.string().min(1),
  media: z.object({
    audio: z.boolean().default(false),
    video: z.boolean().default(false),
    screen: z.boolean().default(false),
  }),
  metadata: jsonObjectSchema.default({}),
});

export const presenceEventSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  roomId: z.string().min(1).nullable().default(null),
  identity: z.string().min(1),
  state: presenceStateSchema,
  emittedAt: isoDateTimeSchema,
  metadata: jsonObjectSchema.default({}),
});

export const canvasActionEnvelopeSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  roomId: z.string().min(1).nullable().default(null),
  traceId: z.string().min(1).nullable().default(null),
  source: z.string().min(1),
  actions: z.array(jsonObjectSchema).default([]),
  metadata: jsonObjectSchema.default({}),
});

export const approvalTokenSchema = z.object({
  id: z.string().min(1),
  approvalRequestId: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  roomId: z.string().min(1).nullable().default(null),
  traceId: z.string().min(1),
  capabilityGrants: z.array(z.string().min(1)).default([]),
  expiresAt: isoDateTimeSchema.nullable().default(null),
  usedAt: isoDateTimeSchema.nullable().default(null),
  metadata: jsonObjectSchema.default({}),
});

export const workspaceSessionSchema = z.object({
  id: z.string().min(1),
  workspacePath: z.string().min(1),
  branch: z.string().min(1),
  title: z.string().min(1),
  state: workspaceSessionStateSchema,
  ownerUserId: z.string().min(1).nullable(),
  activeExecutorSessionId: z.string().min(1).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  metadata: jsonObjectSchema.default({}),
});

export const executorSessionSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  kind: executorKindSchema,
  state: executorSessionStateSchema,
  authMode: z.enum(['chatgpt', 'api_key', 'shared_key', 'byok']),
  codexBaseUrl: z.string().min(1).nullable(),
  capabilities: z.array(sessionCapabilitySchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastHeartbeatAt: isoDateTimeSchema.nullable(),
  metadata: jsonObjectSchema.default({}),
});

export const taskRunSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  traceId: z.string().min(1),
  taskType: z.string().min(1),
  status: taskRunStatusSchema,
  requestId: z.string().min(1).nullable(),
  dedupeKey: z.string().min(1).nullable(),
  summary: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  result: jsonObjectSchema.nullable(),
  error: z.string().nullable(),
  metadata: jsonObjectSchema.default({}),
});

export const artifactSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  traceId: z.string().min(1).nullable(),
  kind: artifactKindSchema,
  title: z.string().min(1),
  mimeType: z.string().min(1),
  content: z.string().default(''),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  metadata: jsonObjectSchema.default({}),
});

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  traceId: z.string().min(1),
  taskRunId: z.string().min(1).nullable(),
  kind: approvalKindSchema,
  state: approvalStateSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  requestedBy: z.string().min(1),
  resolvedBy: z.string().nullable(),
  metadata: jsonObjectSchema.default({}),
});

export const presenceMemberSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  displayName: z.string().min(1),
  state: presenceStateSchema,
  media: z.object({
    audio: z.boolean().default(false),
    video: z.boolean().default(false),
    screen: z.boolean().default(false),
  }),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  metadata: jsonObjectSchema.default({}),
});

export const modelProfileSchema = z.object({
  id: z.string().min(1),
  role: modelRoleSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  label: z.string().min(1),
  source: modelSourceSchema,
  default: z.boolean(),
  latencyClass: z.enum(['instant', 'interactive', 'deep']),
  supports: z.array(z.string().min(1)).default([]),
  metadata: jsonObjectSchema.default({}),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const runtimeManifestSchema = z.object({
  generatedAt: isoDateTimeSchema,
  schemaVersion: z.literal('canvas-os/v1').default('canvas-os/v1'),
  runtimeCenter: z.literal('responses').default('responses'),
  primarySurface: z.literal('canvas').default('canvas'),
  codex: z.object({
    appServerBaseUrl: z.string().min(1),
    authModes: z.array(z.enum(['chatgpt', 'api_key', 'shared_key', 'byok'])),
    recommendedModels: z.array(z.string().min(1)),
  }),
  mcp: z.object({
    serverName: z.string().min(1),
    transport: z.enum(['stdio', 'http']),
    command: z.array(z.string().min(1)),
  }),
  connectors: z.array(connectorDescriptorSchema).default([]),
  resources: z.array(canvasResourceDescriptorSchema).default([]),
  events: z.array(canvasEventDescriptorSchema).default([]),
  approvalPolicies: z.array(approvalPolicySchema).default([]),
  traceSchemaUri: z.string().min(1).default('present://schemas/trace-linkage'),
  registry: manifestRegistrySchema.default({
    uri: 'present://runtime/registry',
    updatedAt: new Date(0).toISOString(),
    connectorCount: 0,
  }),
  media: mediaRuntimeSchema.default({
    provider: 'livekit',
    transport: 'webrtc',
    supports: ['audio', 'video', 'screen', 'data_channel'],
    roomIdTemplate: 'reset-{workspaceSessionId}',
  }),
  collaboration: collaborationRuntimeSchema.default({
    livekitEnabled: true,
    canvasEnabled: true,
    widgetsEnabled: true,
    dualClient: true,
    canvasTransport: 'tldraw_sync',
    sharedDocTransport: 'yjs_ws',
    presenceTransport: 'webrtc',
    operatorSurfaces: ['canvas', 'shell', 'archive'],
    defaultRoomId: null,
  }),
});

export const commandInvocationSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string().min(1)).default([]),
  cwd: z.string().min(1),
});

export const interopUriSetSchema = z.object({
  manifest: z.string().min(1),
  registry: z.string().min(1),
  workspace: z.string().min(1),
  artifacts: z.string().min(1),
  approvals: z.string().min(1),
  presence: z.string().min(1),
  traces: z.string().min(1),
  models: z.string().min(1),
});

export const interopEventUriSetSchema = z.object({
  taskStreamTemplate: z.string().min(1),
  traces: z.string().min(1),
  presence: z.string().min(1),
  livekitCommentary: z.string().min(1),
});

export const interopApprovalUriSetSchema = z.object({
  state: z.string().min(1),
  resolve: z.string().min(1),
});

export const connectorHintSchema = z.object({
  connectorId: z.string().min(1),
  purpose: z.string().min(1),
  preferWhen: z.string().min(1),
});

export const agentInteropPackSchema = z.object({
  generatedAt: isoDateTimeSchema,
  surface: z.literal('canvas').default('canvas'),
  workspaceSessionId: z.string().min(1).nullable(),
  workspacePath: z.string().min(1).nullable(),
  manifestUri: z.string().min(1).default('present://runtime/manifest'),
  registryUri: z.string().min(1).default('present://runtime/registry'),
  resourceUris: interopUriSetSchema.default({
    manifest: 'present://runtime/manifest',
    registry: 'present://runtime/registry',
    workspace: 'present://workspaces/state',
    artifacts: 'present://artifacts/state',
    approvals: 'present://approvals/state',
    presence: 'present://presence/state',
    traces: 'present://traces/state',
    models: 'present://models/status',
  }),
  eventUris: interopEventUriSetSchema.default({
    taskStreamTemplate: '/api/reset/tasks/{taskId}/events',
    traces: '/api/reset/traces',
    presence: '/api/reset/presence',
    livekitCommentary: 'livekit:data-channel:{roomId}',
  }),
  approvalUris: interopApprovalUriSetSchema.default({
    state: 'present://approvals/state',
    resolve: '/api/reset/approvals',
  }),
  roomId: z.string().min(1).nullable().default(null),
  mcpServer: z.object({
    name: z.string().min(1),
    transport: z.enum(['stdio', 'http']),
    command: z.string().min(1),
    args: z.array(z.string().min(1)).default([]),
    cwd: z.string().min(1),
    env: z.record(z.string(), z.string()).default({}),
  }),
  commands: z.object({
    openWorkspace: commandInvocationSchema,
    inspectWorkspace: commandInvocationSchema,
    startTurn: commandInvocationSchema,
    printManifest: commandInvocationSchema,
  }),
  connectorHints: z.array(connectorHintSchema).default([]),
  recommendedClients: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([]),
});

export const workspaceFileEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative().nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
  language: z.string().nullable(),
});

export const workspaceFileDocumentSchema = workspaceFileEntrySchema.extend({
  kind: z.literal('file'),
  content: z.string(),
});

export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;
export type ExecutorSession = z.infer<typeof executorSessionSchema>;
export type TaskRun = z.infer<typeof taskRunSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type PresenceMember = z.infer<typeof presenceMemberSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;
export type AgentInteropPack = z.infer<typeof agentInteropPackSchema>;
export type ConnectorDescriptor = z.infer<typeof connectorDescriptorSchema>;
export type CanvasResourceDescriptor = z.infer<typeof canvasResourceDescriptorSchema>;
export type CanvasEventDescriptor = z.infer<typeof canvasEventDescriptorSchema>;
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export type ConnectorRegistrySnapshot = z.infer<typeof connectorRegistrySnapshotSchema>;
export type TraceLinkage = z.infer<typeof traceLinkageSchema>;
export type AgentSeat = z.infer<typeof agentSeatSchema>;
export type WidgetInstance = z.infer<typeof widgetInstanceSchema>;
export type ArtifactNode = z.infer<typeof artifactNodeSchema>;
export type RunNode = z.infer<typeof runNodeSchema>;
export type MediaTile = z.infer<typeof mediaTileSchema>;
export type PresenceEvent = z.infer<typeof presenceEventSchema>;
export type CanvasActionEnvelope = z.infer<typeof canvasActionEnvelopeSchema>;
export type WidgetBridgeState = z.infer<typeof widgetBridgeStateSchema>;
export type ApprovalToken = z.infer<typeof approvalTokenSchema>;
export type WorkspaceFileEntry = z.infer<typeof workspaceFileEntrySchema>;
export type WorkspaceFileDocument = z.infer<typeof workspaceFileDocumentSchema>;
