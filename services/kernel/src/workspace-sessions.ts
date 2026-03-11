import { createResetId, RESET_ID_PREFIXES } from './ids';
import { workspaceSessionSchema, type WorkspaceSession } from '@present/contracts';
import { readResetCollection, writeResetCollection } from './persistence';

export function listWorkspaceSessions() {
  return readResetCollection('workspaces').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getWorkspaceSession(workspaceSessionId: string) {
  return listWorkspaceSessions().find((session) => session.id === workspaceSessionId) ?? null;
}

export function openWorkspaceSession(input: {
  workspacePath: string;
  branch?: string | null;
  title?: string | null;
  ownerUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const existing = listWorkspaceSessions().find((session) => session.workspacePath === input.workspacePath);
  if (existing) {
    const next = workspaceSessionSchema.parse({
      ...existing,
      branch: input.branch?.trim() || existing.branch,
      title: input.title?.trim() || existing.title,
      updatedAt: now,
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {}),
      },
    });
    writeResetCollection(
      'workspaces',
      [...listWorkspaceSessions().filter((session) => session.id !== next.id), next].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    return next;
  }

  const session = workspaceSessionSchema.parse({
    id: createResetId(RESET_ID_PREFIXES.workspaceSession),
    workspacePath: input.workspacePath,
    branch: input.branch?.trim() || 'codex/reset',
    title: input.title?.trim() || input.workspacePath.split('/').filter(Boolean).at(-1) || 'Workspace',
    state: 'active',
    ownerUserId: input.ownerUserId ?? null,
    activeExecutorSessionId: null,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? {},
  });
  writeResetCollection('workspaces', [session, ...listWorkspaceSessions()]);
  return session;
}

export function updateWorkspaceSession(
  workspaceSessionId: string,
  patch: Partial<Omit<WorkspaceSession, 'id' | 'createdAt'>>,
) {
  const current = getWorkspaceSession(workspaceSessionId);
  if (!current) return null;
  const next = workspaceSessionSchema.parse({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...current.metadata,
      ...(patch.metadata ?? {}),
    },
  });
  writeResetCollection(
    'workspaces',
    [...listWorkspaceSessions().filter((session) => session.id !== workspaceSessionId), next].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
  return next;
}
