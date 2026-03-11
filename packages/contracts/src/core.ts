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
});

export const runtimeManifestSchema = z.object({
  generatedAt: isoDateTimeSchema,
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
  collaboration: z.object({
    livekitEnabled: z.boolean(),
    canvasEnabled: z.boolean(),
    widgetsEnabled: z.boolean(),
    dualClient: z.boolean(),
  }),
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
export type WorkspaceFileEntry = z.infer<typeof workspaceFileEntrySchema>;
export type WorkspaceFileDocument = z.infer<typeof workspaceFileDocumentSchema>;
