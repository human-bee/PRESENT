'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/shared/button';
import { ComponentRegistry, useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { codexRemoteWidgetSchema, type CodexRemoteWidgetProps } from './codex-remote-widget-schema';

export { codexRemoteWidgetSchema };

type PersistedWidgetState = {
  title?: string;
  subtitle?: string;
  frameUrl?: string;
  widgetSessionId?: string;
  workspaceSessionId?: string;
  remoteSessionId?: string;
  serverId?: string;
  connectionId?: string;
  executorSessionId?: string;
  remoteWorkspaceId?: string;
  remoteWorkspacePath?: string;
  status?: string;
  authState?: string;
  activeThreadId?: string;
  lastHeartbeatAt?: string;
  lastError?: string;
};

type CanvasCodexRemoteWidgetProps = CodexRemoteWidgetProps & {
  state?: PersistedWidgetState;
  updateState?: (patch: PersistedWidgetState | ((prev: PersistedWidgetState) => PersistedWidgetState)) => void;
};

type WidgetCodexServer = {
  id: string;
  label: string;
  description: string | null;
  authStrategy: 'none' | 'external_url' | 'iframe';
  authState: 'unknown' | 'login_required' | 'pending' | 'authenticated' | 'expired';
  authUrl: string | null;
  workspaces: Array<{
    id: string;
    label: string;
    path: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type WidgetCodexConnection = {
  id: string;
  widgetSessionId: string;
  serverId: string;
  brokerSessionId: string;
  remoteWorkspaceId: string | null;
  remoteWorkspacePath: string;
  frameUrl: string;
  proxyBaseUrl: string;
  status: 'disconnected' | 'connecting' | 'ready' | 'error';
  authState: 'unknown' | 'login_required' | 'pending' | 'authenticated' | 'expired';
  lastHeartbeatAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type WidgetCodexWidgetSession = {
  id: string;
  title: string;
  serverId: string | null;
  connectionId: string | null;
  remoteWorkspaceId: string | null;
  remoteWorkspacePath: string | null;
  status: 'disconnected' | 'connecting' | 'ready' | 'error';
  authState: 'unknown' | 'login_required' | 'pending' | 'authenticated' | 'expired';
  activeThreadId: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type WidgetCodexSnapshot = {
  realtimeUrl: string | null;
  servers: WidgetCodexServer[];
  widgetSession: WidgetCodexWidgetSession | null;
  connection: WidgetCodexConnection | null;
};

type ResetWorkspaceSession = {
  id: string;
  title: string;
  workspacePath: string;
};

type ResetExecutorSession = {
  id: string;
};

type ResetTaskRun = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  summary: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

type RemoteCodexMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status?: ResetTaskRun['status'];
  timestamp?: string | null;
};

const REMOTE_EXECUTOR_CAPABILITIES = ['code_edit', 'code_review', 'canvas_edit', 'widget_render', 'mcp_server'] as const;

type HttpError = Error & {
  status?: number;
};

const stopPointerPropagation: React.PointerEventHandler<HTMLElement> = (event) => {
  event.stopPropagation();
};

function createFallbackId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `codex-remote-${crypto.randomUUID()}`;
  }
  return `codex-remote-${Date.now().toString(36)}`;
}

function createWidgetSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wcws_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `wcws_${Date.now().toString(36)}`;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = new Error(
      typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`,
    ) as HttpError;
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function buildInitialState(
  persistedState: PersistedWidgetState | undefined,
  rest: CodexRemoteWidgetProps,
) {
  return {
    title: persistedState?.title ?? rest.title ?? 'Remote Codex',
    subtitle: persistedState?.subtitle ?? rest.subtitle ?? '',
    frameUrl: persistedState?.frameUrl ?? rest.frameUrl,
    widgetSessionId: persistedState?.widgetSessionId,
    workspaceSessionId: persistedState?.workspaceSessionId,
    remoteSessionId: persistedState?.remoteSessionId,
    serverId: persistedState?.serverId,
    connectionId: persistedState?.connectionId,
    executorSessionId: persistedState?.executorSessionId,
    remoteWorkspaceId: persistedState?.remoteWorkspaceId,
    remoteWorkspacePath: persistedState?.remoteWorkspacePath,
    status: persistedState?.status ?? 'disconnected',
    authState: persistedState?.authState ?? 'unknown',
    activeThreadId: persistedState?.activeThreadId,
    lastHeartbeatAt: persistedState?.lastHeartbeatAt,
    lastError: persistedState?.lastError,
  } satisfies PersistedWidgetState;
}

function deriveWsUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  } catch {
    return null;
  }
}

function serializeWorkspacesInput(lines: string) {
  return lines
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawLabel, rawPath] = entry.includes('|') ? entry.split('|', 2) : [null, entry];
      const path = rawPath.trim();
      const label = rawLabel?.trim() || path.split('/').filter(Boolean).at(-1) || path;
      return {
        id: `workspace-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        label,
        path,
      };
    });
}

function workspacesToInput(workspaces: WidgetCodexServer['workspaces']) {
  return workspaces.map((workspace) => `${workspace.label}|${workspace.path}`).join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildMessagesFromTasks(tasks: ResetTaskRun[]) {
  return tasks
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .flatMap<RemoteCodexMessage>((task) => {
      const prompt =
        typeof task.metadata.prompt === 'string' && task.metadata.prompt.trim().length > 0
          ? task.metadata.prompt.trim()
          : task.summary;
      const entries: RemoteCodexMessage[] = [
        {
          id: `${task.id}:user`,
          role: 'user',
          text: prompt,
          status: task.status,
          timestamp: task.createdAt,
        },
      ];

      const result = isRecord(task.result) ? task.result : null;
      const finalResponse =
        result && typeof result.finalResponse === 'string' && result.finalResponse.trim().length > 0
          ? result.finalResponse.trim()
          : null;
      if (finalResponse) {
        entries.push({
          id: `${task.id}:assistant`,
          role: 'assistant',
          text: finalResponse,
          status: task.status,
          timestamp: task.completedAt ?? task.updatedAt,
        });
      } else if (task.status === 'failed' && task.error) {
        entries.push({
          id: `${task.id}:error`,
          role: 'system',
          text: task.error,
          status: task.status,
          timestamp: task.updatedAt,
        });
      }

      return entries;
    });
}

export function CodexRemoteWidget(props: CanvasCodexRemoteWidgetProps) {
  const { __custom_message_id, messageId: propMessageId, contextKey, className, ...rest } = props;
  const fallbackIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const websocketRef = useRef<WebSocket | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = createFallbackId();
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;
  const persistedState = props.state;

  const [state, setState] = useState<PersistedWidgetState>(() => buildInitialState(persistedState, rest));
  const [servers, setServers] = useState<WidgetCodexServer[]>([]);
  const [workspaces, setWorkspaces] = useState<WidgetCodexServer['workspaces']>([]);
  const [realtimeUrl, setRealtimeUrl] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(() => persistedState?.title ?? rest.title ?? 'Remote Codex');
  const [selectedServerId, setSelectedServerId] = useState(() => persistedState?.serverId ?? '');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(() => persistedState?.remoteWorkspaceId ?? '');
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(() => !(persistedState?.frameUrl ?? rest.frameUrl));
  const [isBusy, setIsBusy] = useState(false);
  const [showRemoteApp, setShowRemoteApp] = useState(false);
  const [turnDraft, setTurnDraft] = useState('');
  const [messages, setMessages] = useState<RemoteCodexMessage[]>([]);
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null);
  const [showServerForm, setShowServerForm] = useState(false);
  const [serverForm, setServerForm] = useState({
    id: '',
    label: '',
    description: '',
    directTargetUrl: '',
    authStrategy: 'none' as 'none' | 'external_url' | 'iframe',
    authUrl: '',
    workspacesText: '',
  });

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      websocketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const nextState = buildInitialState(persistedState, rest);
    setState(nextState);
    setDraftTitle(nextState.title ?? 'Remote Codex');
    setSelectedServerId(nextState.serverId ?? '');
    setSelectedWorkspaceId(nextState.remoteWorkspaceId ?? '');
    setIsEditing(!nextState.frameUrl);
  }, [
    persistedState?.activeThreadId,
    persistedState?.authState,
    persistedState?.connectionId,
    persistedState?.executorSessionId,
    persistedState?.frameUrl,
    persistedState?.lastError,
    persistedState?.lastHeartbeatAt,
    persistedState?.remoteSessionId,
    persistedState?.remoteWorkspaceId,
    persistedState?.remoteWorkspacePath,
    persistedState?.serverId,
    persistedState?.status,
    persistedState?.subtitle,
    persistedState?.title,
    persistedState?.widgetSessionId,
    persistedState?.workspaceSessionId,
    rest.frameUrl,
    rest.subtitle,
    rest.title,
  ]);

  const registryProps = useMemo(
    () => ({
      ...state,
      className,
      contextKey,
    }),
    [className, contextKey, state],
  );

  useComponentRegistration(messageId, 'CodexRemoteWidget', registryProps, contextKey || 'canvas', (patch) => {
    setState((previous) => {
      const next = {
        ...previous,
        ...patch,
      } satisfies PersistedWidgetState;
      setDraftTitle(next.title ?? 'Remote Codex');
      setSelectedServerId(next.serverId ?? '');
      setSelectedWorkspaceId(next.remoteWorkspaceId ?? '');
      setIsEditing(!next.frameUrl);
      return next;
    });
  });

  const persistState = useCallback(
    async (nextState: PersistedWidgetState) => {
      setState(nextState);
      props.updateState?.(nextState);
      try {
        await ComponentRegistry.update(messageId, nextState);
      } catch {
        /* shape can remount while async updates settle */
      }
    },
    [messageId, props],
  );

  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? null;

  const applySnapshot = useCallback(
    async (snapshot: WidgetCodexSnapshot) => {
      setServers(snapshot.servers);
      setRealtimeUrl(snapshot.realtimeUrl);
      const nextServerId = snapshot.widgetSession?.serverId ?? state.serverId ?? snapshot.servers[0]?.id ?? '';
      if (mountedRef.current) {
        setSelectedServerId(nextServerId);
      }
      const server = snapshot.servers.find((entry) => entry.id === nextServerId) ?? snapshot.servers[0] ?? null;
      setWorkspaces(server?.workspaces ?? []);
      if (mountedRef.current) {
        setSelectedWorkspaceId(
          snapshot.widgetSession?.remoteWorkspaceId ?? state.remoteWorkspaceId ?? server?.workspaces[0]?.id ?? '',
        );
      }
      const nextState: PersistedWidgetState = {
        title: snapshot.widgetSession?.title ?? state.title ?? 'Remote Codex',
        subtitle: snapshot.widgetSession?.remoteWorkspacePath ?? state.subtitle,
        frameUrl: snapshot.connection?.frameUrl ?? undefined,
        widgetSessionId: snapshot.widgetSession?.id ?? state.widgetSessionId ?? createWidgetSessionId(),
        workspaceSessionId: state.workspaceSessionId,
        remoteSessionId: snapshot.connection?.brokerSessionId ?? state.remoteSessionId,
        serverId: snapshot.widgetSession?.serverId ?? (nextServerId || undefined),
        connectionId: snapshot.connection?.id ?? snapshot.widgetSession?.connectionId ?? undefined,
        executorSessionId: state.executorSessionId,
        remoteWorkspaceId: snapshot.widgetSession?.remoteWorkspaceId ?? undefined,
        remoteWorkspacePath: snapshot.widgetSession?.remoteWorkspacePath ?? undefined,
        status: snapshot.connection?.status ?? snapshot.widgetSession?.status ?? 'disconnected',
        authState: snapshot.widgetSession?.authState ?? server?.authState ?? 'unknown',
        activeThreadId: snapshot.widgetSession?.activeThreadId ?? undefined,
        lastHeartbeatAt: snapshot.connection?.lastHeartbeatAt ?? snapshot.widgetSession?.lastHeartbeatAt ?? undefined,
        lastError: snapshot.connection?.lastError ?? snapshot.widgetSession?.lastError ?? undefined,
      };
      await persistState(nextState);
      if (mountedRef.current) {
        setDraftTitle(nextState.title ?? 'Remote Codex');
        setIsEditing(!nextState.frameUrl);
      }
    },
    [
      persistState,
      state.executorSessionId,
      state.remoteWorkspaceId,
      state.remoteSessionId,
      state.serverId,
      state.subtitle,
      state.title,
      state.widgetSessionId,
      state.workspaceSessionId,
    ],
  );

  const loadServers = useCallback(async () => {
    const payload = await requestJson<{ realtimeUrl: string | null; servers: WidgetCodexServer[] }>(
      '/api/widget-codex/servers',
    );
    setServers(payload.servers);
    setRealtimeUrl(payload.realtimeUrl);
    const nextServerId = state.serverId ?? payload.servers[0]?.id ?? '';
    if (mountedRef.current) {
      setSelectedServerId(nextServerId);
    }
    const server = payload.servers.find((entry) => entry.id === nextServerId) ?? payload.servers[0] ?? null;
    setWorkspaces(server?.workspaces ?? []);
    if (mountedRef.current) {
      setSelectedWorkspaceId(state.remoteWorkspaceId ?? server?.workspaces[0]?.id ?? '');
    }
  }, [state.remoteWorkspaceId, state.serverId]);

  const loadSnapshot = useCallback(async () => {
    if (!state.widgetSessionId) {
      await loadServers();
      return;
    }
    const snapshot = await requestJson<WidgetCodexSnapshot>(
      `/api/widget-codex/widgets/${encodeURIComponent(state.widgetSessionId)}`,
    );
    await applySnapshot(snapshot);
  }, [applySnapshot, loadServers, state.widgetSessionId]);

  useEffect(() => {
    void loadSnapshot().catch((error) => {
      if (!mountedRef.current) return;
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to load Widget Codex state.'),
      }));
    });
  }, [loadSnapshot]);

  const loadWorkspaceConversation = useCallback(
    async (workspaceSessionId: string) => {
      const snapshot = await requestJson<{ tasks: ResetTaskRun[] }>(
        `/api/reset/workspaces/${encodeURIComponent(workspaceSessionId)}/state`,
      );
      setMessages(buildMessagesFromTasks(snapshot.tasks));
      const latestTask = snapshot.tasks
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      const result = latestTask && isRecord(latestTask.result) ? latestTask.result : null;
      const nextThreadId =
        result && typeof result.codexThreadId === 'string' && result.codexThreadId.trim().length > 0
          ? result.codexThreadId.trim()
          : typeof latestTask?.metadata.codexThreadId === 'string' && latestTask.metadata.codexThreadId.trim().length > 0
            ? latestTask.metadata.codexThreadId.trim()
            : state.activeThreadId;
      if (nextThreadId !== state.activeThreadId) {
        await persistState({
          ...state,
          activeThreadId: nextThreadId ?? undefined,
        });
      }
      if (latestTask?.status === 'running' || latestTask?.status === 'queued') {
        setActiveTaskRunId(latestTask.id);
      } else {
        setActiveTaskRunId(null);
      }
    },
    [persistState, state],
  );

  const ensureWorkspaceBinding = useCallback(
    async (connection: WidgetCodexConnection) => {
      let workspaceSessionId = state.workspaceSessionId;
      if (!workspaceSessionId) {
        const existing = await requestJson<{ workspaces: ResetWorkspaceSession[] }>('/api/reset/workspaces');
        const existingWorkspace = existing.workspaces.find((workspace) => workspace.title === `Widget ${state.widgetSessionId}`) ?? null;
        if (existingWorkspace) {
          workspaceSessionId = existingWorkspace.id;
        } else {
          const created = await requestJson<{ workspace: ResetWorkspaceSession }>('/api/reset/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `Widget ${state.widgetSessionId ?? createWidgetSessionId()}`,
              ownerUserId: 'widget-codex',
            }),
          });
          workspaceSessionId = created.workspace.id;
        }
      }

      const result = await requestJson<{ executorSession: ResetExecutorSession }>('/api/reset/executors/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId,
          identity: `widget-codex:${state.widgetSessionId ?? createWidgetSessionId()}`,
          kind: 'hosted_executor',
          authMode: 'shared_key',
          codexBaseUrl: connection.proxyBaseUrl,
          capabilities: [...REMOTE_EXECUTOR_CAPABILITIES],
          metadata: {
            remoteManagedAuth: true,
            remoteSessionId: connection.brokerSessionId,
            remoteWorkingDirectory: connection.remoteWorkspacePath,
            proxyBaseUrl: connection.proxyBaseUrl,
            remoteFrameUrl: connection.frameUrl,
          },
        }),
      });

      const nextState = {
        ...state,
        workspaceSessionId,
        executorSessionId: result.executorSession.id,
      } satisfies PersistedWidgetState;
      await persistState(nextState);
      await loadWorkspaceConversation(workspaceSessionId);
      return nextState;
    },
    [loadWorkspaceConversation, persistState, state],
  );

  useEffect(() => {
    const wsUrl = deriveWsUrl(realtimeUrl);
    if (!wsUrl || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    const url = new URL(wsUrl);
    if (state.widgetSessionId) {
      url.searchParams.set('widgetSessionId', state.widgetSessionId);
    }
    const socket = new WebSocket(url);
    websocketRef.current = socket;

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; payload?: WidgetCodexSnapshot };
        if (payload.type === 'snapshot' && payload.payload) {
          void applySnapshot(payload.payload);
        }
      } catch {
        /* ignore malformed events */
      }
    });

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          widgetSessionId: state.widgetSessionId ?? null,
        }),
      );
    });

    return () => {
      socket.close();
    };
  }, [applySnapshot, realtimeUrl, state.widgetSessionId]);

  const saveServer = useCallback(async () => {
    const workspacesPayload = serializeWorkspacesInput(serverForm.workspacesText);
    const baseBody = {
      label: serverForm.label.trim(),
      description: serverForm.description.trim() || null,
      authStrategy: serverForm.authStrategy,
      authUrl: serverForm.authUrl.trim() || null,
      workspaces: workspacesPayload,
    };
    setIsBusy(true);
    try {
      if (serverForm.id) {
        const body = {
          ...baseBody,
          ...(serverForm.directTargetUrl.trim()
            ? { directTargetUrl: serverForm.directTargetUrl.trim() }
            : {}),
        };
        await requestJson(`/api/widget-codex/servers/${encodeURIComponent(serverForm.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        const body = {
          ...baseBody,
          directTargetUrl: serverForm.directTargetUrl.trim(),
        };
        await requestJson('/api/widget-codex/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      setShowServerForm(false);
      setServerForm({
        id: '',
        label: '',
        description: '',
        directTargetUrl: '',
        authStrategy: 'none',
        authUrl: '',
        workspacesText: '',
      });
      await loadServers();
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to save Widget Codex server.'),
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [loadServers, serverForm]);

  const editServer = useCallback(() => {
    if (!selectedServer) return;
    setServerForm({
      id: selectedServer.id,
      label: selectedServer.label,
      description: selectedServer.description ?? '',
      directTargetUrl: '',
      authStrategy: selectedServer.authStrategy,
      authUrl: selectedServer.authUrl ?? '',
      workspacesText: workspacesToInput(selectedServer.workspaces),
    });
    setShowServerForm(true);
  }, [selectedServer]);

  const deleteServer = useCallback(async () => {
    if (!selectedServer) return;
    setIsBusy(true);
    try {
      await requestJson(`/api/widget-codex/servers/${encodeURIComponent(selectedServer.id)}`, {
        method: 'DELETE',
      });
      await loadServers();
      const nextState = {
        ...state,
        serverId: undefined,
        connectionId: undefined,
        frameUrl: undefined,
        status: 'disconnected',
      } satisfies PersistedWidgetState;
      await persistState(nextState);
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to delete Widget Codex server.'),
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [loadServers, persistState, selectedServer, state]);

  const startAuth = useCallback(async () => {
    if (!selectedServerId) return;
    setIsBusy(true);
    try {
      const payload = await requestJson<{ authState: string; loginUrl: string | null }>(
        `/api/widget-codex/servers/${encodeURIComponent(selectedServerId)}/auth/start`,
        { method: 'POST' },
      );
      setLoginUrl(payload.loginUrl);
      await loadServers();
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to start server authentication.'),
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [loadServers, selectedServerId]);

  const completeAuth = useCallback(async () => {
    if (!selectedServerId) return;
    setIsBusy(true);
    try {
      await requestJson(`/api/widget-codex/servers/${encodeURIComponent(selectedServerId)}/auth/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          widgetSessionId: state.widgetSessionId ?? createWidgetSessionId(),
          remoteWorkspaceId: selectedWorkspaceId || undefined,
          remoteWorkspacePath:
            workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.path ?? undefined,
        }),
      });
      setLoginUrl(null);
      await loadServers();
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to complete server authentication.'),
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [loadServers, selectedServerId]);

  const connectRemoteCodex = useCallback(async () => {
    if (!selectedServerId) return;
    setIsBusy(true);
    try {
      const payload = await requestJson<{
        widgetSession: WidgetCodexWidgetSession | null;
        connection: WidgetCodexConnection | null;
      }>('/api/widget-codex/connections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          widgetSessionId: state.widgetSessionId ?? createWidgetSessionId(),
          title: draftTitle.trim() || 'Remote Codex',
          serverId: selectedServerId,
          remoteWorkspaceId: selectedWorkspaceId || undefined,
          remoteWorkspacePath:
            workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.path ?? undefined,
        }),
      });
      await applySnapshot({
        realtimeUrl,
        servers,
        widgetSession: payload.widgetSession,
        connection: payload.connection,
      });
      setIsEditing(false);
      if (payload.connection) {
        try {
          await ensureWorkspaceBinding(payload.connection);
        } catch (bindingError) {
          setState((previous) => ({
            ...previous,
            lastError: getErrorMessage(bindingError, 'Connected, but widget executor binding is still pending.'),
          }));
        }
      }
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to connect Remote Codex widget.'),
        status: 'error',
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [
    applySnapshot,
    draftTitle,
    ensureWorkspaceBinding,
    realtimeUrl,
    selectedServerId,
    selectedWorkspaceId,
    servers,
    state.widgetSessionId,
    workspaces,
  ]);

  const refreshConnection = useCallback(async () => {
    if (!state.connectionId) return;
    setIsBusy(true);
    try {
      const payload = await requestJson<{ connection: WidgetCodexConnection }>(
        `/api/widget-codex/connections/${encodeURIComponent(state.connectionId)}`,
      );
      await persistState({
        ...state,
        frameUrl: payload.connection.frameUrl,
        serverId: payload.connection.serverId,
        remoteWorkspaceId: payload.connection.remoteWorkspaceId ?? undefined,
        remoteWorkspacePath: payload.connection.remoteWorkspacePath,
        status: payload.connection.status,
        authState: payload.connection.authState,
        lastHeartbeatAt: payload.connection.lastHeartbeatAt ?? undefined,
        lastError: payload.connection.lastError ?? undefined,
      });
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to refresh Widget Codex connection.'),
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [persistState, state]);

  useEffect(() => {
    if (!state.connectionId) return;
    const interval = window.setInterval(() => {
      void refreshConnection();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [refreshConnection, state.connectionId]);

  useEffect(() => {
    if (!state.workspaceSessionId) return;
    void loadWorkspaceConversation(state.workspaceSessionId).catch((error) => {
      if (!mountedRef.current) return;
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to load widget Codex conversation.'),
      }));
    });
  }, [loadWorkspaceConversation, state.workspaceSessionId]);

  useEffect(() => {
    if (!state.frameUrl || !state.connectionId || state.workspaceSessionId || !state.widgetSessionId) return;
    const connection = state.frameUrl && state.remoteWorkspacePath
      ? {
          id: state.connectionId,
          widgetSessionId: state.widgetSessionId,
          serverId: state.serverId ?? '',
          brokerSessionId: state.remoteSessionId ?? state.connectionId,
          remoteWorkspaceId: state.remoteWorkspaceId ?? null,
          remoteWorkspacePath: state.remoteWorkspacePath,
          frameUrl: state.frameUrl,
          proxyBaseUrl: state.frameUrl.replace(/\/$/, ''),
          status: (state.status as WidgetCodexConnection['status']) ?? 'ready',
          authState: (state.authState as WidgetCodexConnection['authState']) ?? 'unknown',
          lastHeartbeatAt: state.lastHeartbeatAt ?? null,
          lastError: state.lastError ?? null,
          createdAt: state.lastHeartbeatAt ?? new Date().toISOString(),
          updatedAt: state.lastHeartbeatAt ?? new Date().toISOString(),
        }
      : null;
    if (!connection) return;
    void ensureWorkspaceBinding(connection).catch((error) => {
      if (!mountedRef.current) return;
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to bind widget executor.'),
      }));
    });
  }, [
    ensureWorkspaceBinding,
    state.authState,
    state.connectionId,
    state.frameUrl,
    state.lastError,
    state.lastHeartbeatAt,
    state.remoteWorkspaceId,
    state.remoteWorkspacePath,
    state.remoteSessionId,
    state.serverId,
    state.status,
    state.widgetSessionId,
    state.workspaceSessionId,
  ]);

  const disconnectRemoteCodex = useCallback(async () => {
    if (!state.connectionId) return;
    setIsBusy(true);
    try {
      await requestJson(`/api/widget-codex/connections/${encodeURIComponent(state.connectionId)}`, {
        method: 'DELETE',
      });
      await persistState({
        ...state,
        frameUrl: undefined,
        connectionId: undefined,
        status: 'disconnected',
        lastError: undefined,
      });
      setIsEditing(true);
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to disconnect Widget Codex connection.'),
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [persistState, state]);

  const sendTurn = useCallback(async () => {
    if (!turnDraft.trim() || !state.frameUrl || !state.connectionId) return;
    setIsBusy(true);
    try {
      const connection: WidgetCodexConnection = {
        id: state.connectionId,
        widgetSessionId: state.widgetSessionId ?? createWidgetSessionId(),
        serverId: state.serverId ?? '',
        brokerSessionId: state.remoteSessionId ?? state.connectionId,
        remoteWorkspaceId: state.remoteWorkspaceId ?? null,
        remoteWorkspacePath: state.remoteWorkspacePath ?? state.subtitle ?? '',
        frameUrl: state.frameUrl,
        proxyBaseUrl: state.frameUrl.replace(/\/$/, ''),
        status: (state.status as WidgetCodexConnection['status']) ?? 'ready',
        authState: (state.authState as WidgetCodexConnection['authState']) ?? 'unknown',
        lastHeartbeatAt: state.lastHeartbeatAt ?? null,
        lastError: state.lastError ?? null,
        createdAt: state.lastHeartbeatAt ?? new Date().toISOString(),
        updatedAt: state.lastHeartbeatAt ?? new Date().toISOString(),
      };
      const boundState = await ensureWorkspaceBinding(connection);
      if (!boundState.workspaceSessionId || !boundState.executorSessionId) {
        throw new Error('Widget executor binding is not ready yet.');
      }
      const prompt = turnDraft.trim();
      const response = await requestJson<{ taskRun: ResetTaskRun }>('/api/reset/turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: boundState.workspaceSessionId,
          executorSessionId: boundState.executorSessionId,
          summary: prompt.slice(0, 96),
          prompt,
          threadId: boundState.activeThreadId ?? undefined,
        }),
      });
      setTurnDraft('');
      setActiveTaskRunId(response.taskRun.id);
      await loadWorkspaceConversation(boundState.workspaceSessionId);
    } catch (error) {
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to send widget Codex turn.'),
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [ensureWorkspaceBinding, loadWorkspaceConversation, state, turnDraft]);

  useEffect(() => {
    if (!activeTaskRunId || !state.workspaceSessionId) return;
    const interval = window.setInterval(() => {
      void requestJson<{ taskRun: ResetTaskRun }>(`/api/reset/turns?taskRunId=${encodeURIComponent(activeTaskRunId)}`)
        .then(async ({ taskRun }) => {
          if (taskRun.status === 'running' || taskRun.status === 'queued') return;
          setActiveTaskRunId(null);
          await loadWorkspaceConversation(state.workspaceSessionId!);
        })
        .catch((error) => {
          if (!mountedRef.current) return;
          setState((previous) => ({
            ...previous,
            lastError: getErrorMessage(error, 'Failed to poll widget Codex turn.'),
          }));
        });
    }, 1_500);
    return () => window.clearInterval(interval);
  }, [activeTaskRunId, loadWorkspaceConversation, state.workspaceSessionId]);

  const openFrameUrl = useCallback(() => {
    if (typeof window === 'undefined' || !state.frameUrl) return;
    const opened = window.open(state.frameUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(state.frameUrl);
    }
  }, [state.frameUrl]);

  useEffect(() => {
    if (!selectedServer) return;
    setWorkspaces(selectedServer.workspaces);
    if (!selectedWorkspaceId && selectedServer.workspaces[0]?.id) {
      setSelectedWorkspaceId(selectedServer.workspaces[0].id);
    }
  }, [selectedServer, selectedWorkspaceId]);

  const statusLabel =
    state.status === 'ready'
      ? 'Connected'
      : state.status === 'connecting'
        ? 'Connecting'
        : state.status === 'error'
          ? 'Error'
          : 'Disconnected';

  const authLabel =
    selectedServer?.authState === 'authenticated'
      ? 'Authenticated'
      : selectedServer?.authState === 'pending'
        ? 'Login Pending'
        : selectedServer?.authState === 'expired'
          ? 'Login Expired'
        : selectedServer?.authState === 'login_required'
          ? 'Login Required'
          : 'Unknown';

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-3 rounded-[24px] border border-[var(--color-divider)] bg-[var(--color-panel)] p-3',
        className,
      )}
    >
      {state.frameUrl ? (
        <div className="flex h-full flex-col gap-3 rounded-[20px] border border-default bg-surface p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary">{state.title || 'Remote Codex'}</p>
              <p className="mt-1 text-xs text-secondary">
                {state.remoteWorkspacePath || 'Widget-managed remote Codex session'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-default bg-[var(--color-panel)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-secondary">
                {statusLabel}
              </div>
              <div className="rounded-full border border-default bg-[var(--color-panel)] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-secondary">
                {selectedServer?.label || 'No server'}
              </div>
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void refreshConnection()}>
                Refresh
              </Button>
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => setIsEditing(true)}>
                Manage
              </Button>
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void disconnectRemoteCodex()}>
                Disconnect
              </Button>
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => setShowRemoteApp((value) => !value)}>
                {showRemoteApp ? 'Hide Remote App' : 'Show Remote App'}
              </Button>
              <button
                type="button"
                onPointerDown={stopPointerPropagation}
                onClick={openFrameUrl}
                className="text-xs text-[var(--present-accent)] underline underline-offset-2"
              >
                Pop Out
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-xs text-secondary">
            <div>Executor: {state.executorSessionId ?? 'binding...'}</div>
            <div>Workspace Session: {state.workspaceSessionId ?? 'binding...'}</div>
            {state.activeThreadId ? <div>Thread: {state.activeThreadId}</div> : null}
            {activeTaskRunId ? <div>Active turn: {activeTaskRunId}</div> : null}
            {state.lastError ? <div className="text-danger">Last error: {state.lastError}</div> : null}
          </div>

          {isEditing ? (
            <div className="rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-xs text-secondary">
              The connection is live. Disconnect if you need to reconfigure the server or workspace selection.
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-default bg-[var(--color-panel)] p-3">
              {messages.length ? (
                <div className="flex flex-col gap-3">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'max-w-[92%] rounded-2xl px-3 py-2 text-sm',
                        message.role === 'user'
                          ? 'self-end bg-[var(--present-accent)]/12 text-primary'
                          : message.role === 'assistant'
                            ? 'self-start bg-[var(--color-muted)] text-primary'
                            : 'self-start border border-danger/30 bg-danger/10 text-danger',
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">{message.text}</div>
                      {message.timestamp ? (
                        <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-secondary">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-sm text-secondary">
                  Send a prompt here to use the widget as a native Remote Codex client. The remote app iframe is optional now.
                </div>
              )}
            </div>

            <div className="grid gap-2 rounded-xl border border-default bg-[var(--color-panel)] p-3">
              <textarea
                value={turnDraft}
                onPointerDown={stopPointerPropagation}
                onChange={(event) => setTurnDraft(event.target.value)}
                className="min-h-24 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none"
                placeholder="Ask Remote Codex to inspect, edit, review, or run something in the selected remote workspace."
              />
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-secondary">
                  Turns run through a dedicated widget executor bound to this remote connection.
                </div>
                <Button
                  size="sm"
                  onPointerDown={stopPointerPropagation}
                  onClick={() => void sendTurn()}
                  disabled={isBusy || !turnDraft.trim()}
                >
                  {activeTaskRunId ? 'Turn Running...' : 'Send Turn'}
                </Button>
              </div>
            </div>

            {showRemoteApp ? (
              <div className="grid gap-2 rounded-xl border border-default bg-[var(--color-panel)] p-3">
                <div className="text-xs text-secondary">
                  Secondary remote app surface. The primary widget interaction path stays native in-canvas.
                </div>
                <iframe
                  title="Remote Codex App"
                  src={state.frameUrl}
                  className="h-64 w-full rounded-lg border border-default bg-white"
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-3 rounded-[20px] border border-dashed border-[var(--color-divider)] bg-[var(--color-muted)]/30 p-4">
          <div>
            <p className="text-sm font-semibold text-primary">Remote Codex</p>
            <p className="mt-1 text-xs text-secondary">
              Litter-style widget sub-stack: saved servers, login handoff, remote workspace selection, and live connection state.
            </p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Title</span>
            <input
              value={draftTitle}
              onPointerDown={stopPointerPropagation}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              placeholder="Remote Codex"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-secondary">Remote Server</span>
              <select
                value={selectedServerId}
                onPointerDown={stopPointerPropagation}
                onChange={(event) => {
                  setSelectedServerId(event.target.value);
                  const server = servers.find((entry) => entry.id === event.target.value) ?? null;
                  setWorkspaces(server?.workspaces ?? []);
                  setSelectedWorkspaceId(server?.workspaces[0]?.id ?? '');
                  void persistState({
                    ...state,
                    serverId: event.target.value || undefined,
                  });
                }}
                className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none"
              >
                <option value="">Select a server</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-secondary">Remote Workspace</span>
              <select
                value={selectedWorkspaceId}
                onPointerDown={stopPointerPropagation}
                onChange={(event) => {
                  setSelectedWorkspaceId(event.target.value);
                  const workspace = workspaces.find((entry) => entry.id === event.target.value);
                  void persistState({
                    ...state,
                    remoteWorkspaceId: event.target.value || undefined,
                    remoteWorkspacePath: workspace?.path,
                  });
                }}
                className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none"
                disabled={!selectedServerId || workspaces.length === 0}
              >
                <option value="">{workspaces.length ? 'Select a workspace' : 'No workspaces yet'}</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-default bg-surface px-3 py-2 text-xs text-secondary">
            <div>Status: {statusLabel}</div>
            <div>Auth: {authLabel}</div>
            {state.remoteWorkspacePath ? <div>Workspace: {state.remoteWorkspacePath}</div> : null}
            {state.lastHeartbeatAt ? <div>Last heartbeat: {new Date(state.lastHeartbeatAt).toLocaleString()}</div> : null}
            {state.lastError ? <div className="text-danger">Last error: {state.lastError}</div> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => setShowServerForm((value) => !value)}>
              {showServerForm ? 'Hide Server Form' : 'Add Server'}
            </Button>
            {selectedServer ? (
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={editServer}>
                Edit Server
              </Button>
            ) : null}
            {selectedServer ? (
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void deleteServer()}>
                Delete Server
              </Button>
            ) : null}
            {selectedServer && selectedServer.authStrategy !== 'none' ? (
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void startAuth()}>
                Open Login
              </Button>
            ) : null}
            {selectedServer && selectedServer.authStrategy !== 'none' && (loginUrl || selectedServer.authState === 'pending') ? (
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void completeAuth()}>
                Close Login Helper
              </Button>
            ) : null}
          </div>

          {showServerForm ? (
            <div className="grid gap-3 rounded-xl border border-default bg-surface p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Server Label</span>
                <input
                  value={serverForm.label}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) => setServerForm((previous) => ({ ...previous, label: event.target.value }))}
                  className="w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                  placeholder="Remote Codex Prod"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Description</span>
                <input
                  value={serverForm.description}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) => setServerForm((previous) => ({ ...previous, description: event.target.value }))}
                  className="w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                  placeholder="Primary remote Codex app"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Direct Target URL</span>
                <input
                  value={serverForm.directTargetUrl}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) => setServerForm((previous) => ({ ...previous, directTargetUrl: event.target.value }))}
                  className="w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                  placeholder="https://remote-codex.example/"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Auth Strategy</span>
                <select
                  value={serverForm.authStrategy}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) =>
                    setServerForm((previous) => ({
                      ...previous,
                      authStrategy: event.target.value as 'none' | 'external_url' | 'iframe',
                    }))
                  }
                  className="w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                >
                  <option value="none">No extra login</option>
                  <option value="iframe">In-widget login iframe</option>
                  <option value="external_url">External login URL</option>
                </select>
              </label>
              {serverForm.authStrategy !== 'none' ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-secondary">Auth URL</span>
                  <input
                    value={serverForm.authUrl}
                    onPointerDown={stopPointerPropagation}
                    onChange={(event) => setServerForm((previous) => ({ ...previous, authUrl: event.target.value }))}
                    className="w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                    placeholder="https://remote-codex.example/login"
                  />
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Workspaces</span>
                <textarea
                  value={serverForm.workspacesText}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) => setServerForm((previous) => ({ ...previous, workspacesText: event.target.value }))}
                  className="min-h-28 w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                  placeholder={`PRESENT|/srv/codex/repos/PRESENT\nLitter|/srv/codex/repos/litter`}
                />
              </label>
              <div className="flex gap-2">
                <Button size="sm" onPointerDown={stopPointerPropagation} onClick={() => void saveServer()} disabled={isBusy}>
                  {serverForm.id ? 'Save Server' : 'Create Server'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPointerDown={stopPointerPropagation}
                  onClick={() => {
                    setShowServerForm(false);
                    setServerForm({
                      id: '',
                      label: '',
                      description: '',
                      directTargetUrl: '',
                      authStrategy: 'none',
                      authUrl: '',
                      workspacesText: '',
                    });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {loginUrl ? (
            <div className="grid gap-2 rounded-xl border border-default bg-surface p-3">
              <div className="text-xs text-secondary">
                Use this as a login handoff helper. The widget does not claim server-side auth proof until a real callback flow exists.
              </div>
              <iframe
                title="Widget Codex Login"
                src={loginUrl}
                className="h-48 w-full rounded-lg border border-default bg-white"
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onPointerDown={stopPointerPropagation}
              onClick={() => void connectRemoteCodex()}
              disabled={isBusy || !selectedServerId}
            >
              {isBusy ? 'Working...' : state.connectionId ? 'Reconnect Remote Codex' : 'Connect Remote Codex'}
            </Button>
            {state.connectionId ? (
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void disconnectRemoteCodex()}>
                Disconnect
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default CodexRemoteWidget;
