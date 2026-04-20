import {
  getWorkspaceSession,
  listExecutorSessions,
  registerExecutorSession,
  setExecutorSessionState,
  updateWorkspaceSession,
} from '@present/kernel';
import type { ExecutorSession, WorkspaceSession } from '@present/contracts';
import type { CodexBrokerSessionSnapshot } from '@present/codex-broker/session-store';

type CodexRemoteWorkspaceMetadata = {
  sessionId: string | null;
  remoteWorkspacePath: string;
  frameUrl: string | null;
  proxyBaseUrl: string | null;
  status: 'ready' | 'disconnected' | 'error';
  lastHeartbeatAt: string | null;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
};

const REMOTE_EXECUTOR_CAPABILITIES: ExecutorSession['capabilities'] = [
  'code_edit',
  'code_review',
  'canvas_edit',
  'widget_render',
  'mcp_server',
];

const REMOTE_EXECUTOR_IDENTITY_PREFIX = 'remote-codex';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

export const buildRemoteExecutorIdentity = (workspaceSessionId: string) =>
  `${REMOTE_EXECUTOR_IDENTITY_PREFIX}:${workspaceSessionId}`;

export const readCodexRemoteWorkspaceMetadata = (workspace: WorkspaceSession | null): CodexRemoteWorkspaceMetadata | null => {
  if (!workspace) return null;
  const raw = workspace.metadata['codexRemote'];
  if (!isRecord(raw)) return null;
  const remoteWorkspacePath =
    typeof raw.remoteWorkspacePath === 'string' && raw.remoteWorkspacePath.trim()
      ? raw.remoteWorkspacePath.trim()
      : workspace.workspacePath;
  return {
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId.trim() : null,
    remoteWorkspacePath,
    frameUrl: typeof raw.frameUrl === 'string' && raw.frameUrl.trim() ? raw.frameUrl.trim() : null,
    proxyBaseUrl: typeof raw.proxyBaseUrl === 'string' && raw.proxyBaseUrl.trim() ? raw.proxyBaseUrl.trim() : null,
    status:
      raw.status === 'ready' || raw.status === 'error' || raw.status === 'disconnected'
        ? raw.status
        : 'disconnected',
    lastHeartbeatAt:
      typeof raw.lastHeartbeatAt === 'string' && raw.lastHeartbeatAt.trim() ? raw.lastHeartbeatAt.trim() : null,
    connectedAt: typeof raw.connectedAt === 'string' && raw.connectedAt.trim() ? raw.connectedAt.trim() : null,
    disconnectedAt:
      typeof raw.disconnectedAt === 'string' && raw.disconnectedAt.trim() ? raw.disconnectedAt.trim() : null,
  };
};

export const resolveRemoteWorkingDirectory = (
  workspace: WorkspaceSession,
  requestedRemoteWorkspacePath?: string | null,
) => {
  const explicit = requestedRemoteWorkspacePath?.trim();
  if (explicit) return explicit;
  const metadata = readCodexRemoteWorkspaceMetadata(workspace);
  if (metadata?.remoteWorkspacePath) return metadata.remoteWorkspacePath;
  return workspace.workspacePath;
};

export const findRemoteExecutorBySessionId = (sessionId: string) =>
  listExecutorSessions().find((executor) => executor.metadata['remoteSessionId'] === sessionId) ?? null;

export const findRemoteExecutorForWorkspace = (workspaceSessionId: string, sessionId?: string | null) => {
  const executors = listExecutorSessions(workspaceSessionId);
  if (sessionId) {
    const match = executors.find((executor) => executor.metadata['remoteSessionId'] === sessionId);
    if (match) return match;
  }
  return executors.find((executor) => executor.identity === buildRemoteExecutorIdentity(workspaceSessionId)) ?? null;
};

export const upsertRemoteExecutor = (workspaceSessionId: string, session: CodexBrokerSessionSnapshot) =>
  registerExecutorSession({
    workspaceSessionId,
    identity: buildRemoteExecutorIdentity(workspaceSessionId),
    kind: 'hosted_executor',
    authMode: 'shared_key',
    codexBaseUrl: session.proxyBaseUrl,
    capabilities: REMOTE_EXECUTOR_CAPABILITIES,
    metadata: {
      remoteManagedAuth: true,
      remoteSessionId: session.sessionId,
      remoteWorkingDirectory: session.remoteWorkingDirectory,
      proxyBaseUrl: session.proxyBaseUrl,
      remoteFrameUrl: session.frameUrl,
    },
  });

export const persistConnectedRemoteWorkspace = (
  workspaceSessionId: string,
  session: CodexBrokerSessionSnapshot,
  executorSessionId: string,
) =>
  updateWorkspaceSession(workspaceSessionId, {
    activeExecutorSessionId: executorSessionId,
    metadata: {
      codexRemote: {
        sessionId: session.sessionId,
        remoteWorkspacePath: session.remoteWorkingDirectory,
        frameUrl: session.frameUrl,
        proxyBaseUrl: session.proxyBaseUrl,
        status: session.status === 'closed' ? 'disconnected' : session.status,
        lastHeartbeatAt: session.lastHeartbeatAt,
        connectedAt: new Date().toISOString(),
        disconnectedAt: null,
      } satisfies CodexRemoteWorkspaceMetadata,
    },
  });

export const persistDisconnectedRemoteWorkspace = (workspaceSessionId: string, sessionId?: string | null) => {
  const workspace = getWorkspaceSession(workspaceSessionId);
  if (!workspace) return null;
  const previous = readCodexRemoteWorkspaceMetadata(workspace);
  const remoteExecutor = findRemoteExecutorForWorkspace(workspaceSessionId, sessionId);
  if (remoteExecutor) {
    setExecutorSessionState(remoteExecutor.id, 'offline');
  }
  const fallbackExecutorId =
    listExecutorSessions(workspaceSessionId).find((executor) => executor.id !== remoteExecutor?.id)?.id ?? null;
  return updateWorkspaceSession(workspaceSessionId, {
    activeExecutorSessionId: fallbackExecutorId,
    metadata: {
      codexRemote: {
        sessionId: null,
        remoteWorkspacePath:
          previous?.remoteWorkspacePath ??
          (typeof remoteExecutor?.metadata['remoteWorkingDirectory'] === 'string'
            ? String(remoteExecutor.metadata['remoteWorkingDirectory'])
            : workspace.workspacePath),
        frameUrl: null,
        proxyBaseUrl: null,
        status: 'disconnected',
        lastHeartbeatAt: previous?.lastHeartbeatAt ?? null,
        connectedAt: previous?.connectedAt ?? null,
        disconnectedAt: new Date().toISOString(),
      } satisfies CodexRemoteWorkspaceMetadata,
    },
  });
};
