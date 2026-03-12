import {
  executorSessionSchema,
  type ExecutorSession,
} from '@present/contracts';
import { createResetId, RESET_ID_PREFIXES } from './ids';
import { readResetCollection, writeResetCollection } from './persistence';
import { updateWorkspaceSession } from './workspace-sessions';

export function listExecutorSessions(workspaceSessionId?: string) {
  return readResetCollection('executors')
    .filter((session) => !workspaceSessionId || session.workspaceSessionId === workspaceSessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function registerExecutorSession(input: {
  workspaceSessionId: string;
  identity: string;
  kind: ExecutorSession['kind'];
  authMode: ExecutorSession['authMode'];
  codexBaseUrl?: string | null;
  capabilities?: ExecutorSession['capabilities'];
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const existing = listExecutorSessions(input.workspaceSessionId).find((session) => session.identity === input.identity);
  if (existing) {
    const next = executorSessionSchema.parse({
      ...existing,
      kind: input.kind,
      authMode: input.authMode,
      codexBaseUrl: input.codexBaseUrl ?? existing.codexBaseUrl,
      capabilities: input.capabilities ?? existing.capabilities,
      state: 'ready',
      updatedAt: now,
      lastHeartbeatAt: now,
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {}),
      },
    });
    updateWorkspaceSession(input.workspaceSessionId, { activeExecutorSessionId: next.id });
    writeResetCollection(
      'executors',
      [...listExecutorSessions().filter((session) => session.id !== next.id), next].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    return next;
  }

  const session = executorSessionSchema.parse({
    id: createResetId(RESET_ID_PREFIXES.executorSession),
    workspaceSessionId: input.workspaceSessionId,
    identity: input.identity,
    kind: input.kind,
    state: 'ready',
    authMode: input.authMode,
    codexBaseUrl: input.codexBaseUrl ?? null,
    capabilities: input.capabilities ?? [],
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
    metadata: input.metadata ?? {},
  });
  writeResetCollection('executors', [session, ...listExecutorSessions()]);
  updateWorkspaceSession(input.workspaceSessionId, { activeExecutorSessionId: session.id });
  return session;
}

export function heartbeatExecutorSession(executorSessionId: string) {
  const current = listExecutorSessions().find((session) => session.id === executorSessionId);
  if (!current) return null;
  const now = new Date().toISOString();
  const next = executorSessionSchema.parse({
    ...current,
    state: 'ready',
    updatedAt: now,
    lastHeartbeatAt: now,
  });
  writeResetCollection(
    'executors',
    [...listExecutorSessions().filter((session) => session.id !== executorSessionId), next].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
  return next;
}

export function setExecutorSessionState(executorSessionId: string, state: ExecutorSession['state']) {
  const current = listExecutorSessions().find((session) => session.id === executorSessionId);
  if (!current) return null;
  const next = executorSessionSchema.parse({
    ...current,
    state,
    updatedAt: new Date().toISOString(),
  });
  writeResetCollection(
    'executors',
    [...listExecutorSessions().filter((session) => session.id !== executorSessionId), next].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
  return next;
}
