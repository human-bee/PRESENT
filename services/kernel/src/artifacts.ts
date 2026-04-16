import {
  artifactSchema,
  widgetRuntimeEnvelopeSchema,
  type Artifact,
  type WidgetRuntimeEnvelope,
} from '@present/contracts';
import { execFileSync } from 'node:child_process';
import { consumeApprovalRequest } from './approvals';
import { createResetId, RESET_ID_PREFIXES } from './ids';
import { recordKernelEvent } from './traces';
import { readResetCollection, writeResetCollection } from './persistence';
import { getWorkspaceSession } from './workspace-sessions';

export const resolveArtifactWidgetRuntime = (input: {
  content?: string;
  metadata?: Record<string, unknown>;
}): WidgetRuntimeEnvelope | null => {
  const candidate = input.metadata?.['widgetRuntime'];
  const parsed = widgetRuntimeEnvelopeSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  if (typeof input.content === 'string' && input.content.trim()) {
    return widgetRuntimeEnvelopeSchema.parse({
      hostKind: 'html_bundle',
      componentType: null,
      componentProps: {},
      resourceUri: null,
      serverName: null,
      toolName: null,
      args: null,
      displayMode: 'inline',
      contextKey: 'canvas',
    });
  }

  return null;
};

const normalizeArtifactMetadata = (input: {
  kind: Artifact['kind'];
  content?: string;
  metadata?: Record<string, unknown>;
}) => {
  const metadata = { ...(input.metadata ?? {}) };
  if (input.kind !== 'widget_bundle') {
    return metadata;
  }

  const widgetRuntime = resolveArtifactWidgetRuntime({
    content: input.content,
    metadata,
  });

  if (!widgetRuntime) {
    return metadata;
  }

  return {
    ...metadata,
    widgetRuntime,
  };
};

export function createArtifact(input: {
  workspaceSessionId: string;
  traceId?: string | null;
  kind: Artifact['kind'];
  title: string;
  mimeType: string;
  content?: string;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const artifact = artifactSchema.parse({
    id: createResetId(RESET_ID_PREFIXES.artifact),
    workspaceSessionId: input.workspaceSessionId,
    traceId: input.traceId ?? null,
    kind: input.kind,
    title: input.title,
    mimeType: input.mimeType,
    content: input.content ?? '',
    createdAt: now,
    updatedAt: now,
    metadata: normalizeArtifactMetadata({
      kind: input.kind,
      content: input.content,
      metadata: input.metadata,
    }),
  });
  writeResetCollection('artifacts', [artifact, ...listArtifacts()]);
  return artifact;
}

export function listArtifacts(workspaceSessionId?: string) {
  return readResetCollection('artifacts')
    .filter((artifact) => !workspaceSessionId || artifact.workspaceSessionId === workspaceSessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getArtifact(artifactId: string) {
  return listArtifacts().find((artifact) => artifact.id === artifactId) ?? null;
}

export function applyArtifactPatch(input: {
  artifactId: string;
  approvalRequestId: string;
  resolvedBy: string;
}) {
  const artifact = getArtifact(input.artifactId);
  if (!artifact) {
    throw new Error('Artifact not found');
  }
  if (artifact.kind !== 'file_patch' || !artifact.content.trim()) {
    throw new Error('Artifact is not an applicable file patch');
  }

  const workspace = getWorkspaceSession(artifact.workspaceSessionId);
  if (!workspace) {
    throw new Error('Workspace session not found');
  }

  const approval = consumeApprovalRequest({
    approvalRequestId: input.approvalRequestId,
    workspaceSessionId: artifact.workspaceSessionId,
    resolvedBy: input.resolvedBy,
    requiredKinds: ['file_write', 'git_action'],
    metadata: {
      artifactId: artifact.id,
      capabilityUsed: 'artifact.applyPatch',
    },
  });

  execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
    cwd: workspace.workspacePath,
    input: artifact.content,
    encoding: 'utf8',
  });

  recordKernelEvent({
    type: 'patch.applied',
    traceId: artifact.traceId ?? createResetId(RESET_ID_PREFIXES.trace),
    workspaceSessionId: artifact.workspaceSessionId,
    artifactId: artifact.id,
    summary: artifact.title,
    metadata: {
      ...artifact.metadata,
      approvalRequestId: approval.id,
    },
  });

  return artifact;
}
