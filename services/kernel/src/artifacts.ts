import { artifactSchema, type Artifact } from '@present/contracts';
import { execFileSync } from 'node:child_process';
import { createResetId, RESET_ID_PREFIXES } from './ids';
import { recordKernelEvent } from './traces';
import { readResetCollection, writeResetCollection } from './persistence';
import { getWorkspaceSession } from './workspace-sessions';

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
    metadata: input.metadata ?? {},
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

export function applyArtifactPatch(artifactId: string) {
  const artifact = getArtifact(artifactId);
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
    metadata: artifact.metadata,
  });

  return artifact;
}
