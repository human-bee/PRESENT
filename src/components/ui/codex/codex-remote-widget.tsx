'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/shared/button';
import { ComponentRegistry, useComponentRegistration } from '@/lib/component-registry';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
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
  updateState?: (
    patch: PersistedWidgetState | ((prev: PersistedWidgetState) => PersistedWidgetState),
  ) => void;
};

type WidgetCodexServer = {
  id: string;
  label: string;
  description: string | null;
  authStrategy: 'none' | 'external_url' | 'iframe';
  authState: 'unknown' | 'login_required' | 'pending' | 'authenticated' | 'expired';
  authUrl: string | null;
  transportKind: 'direct' | 'ssh';
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

const REMOTE_EXECUTOR_CAPABILITIES = [
  'code_edit',
  'code_review',
  'canvas_edit',
  'widget_render',
  'mcp_server',
] as const;

type HttpError = Error & {
  status?: number;
};

type ServerFormState = {
  id: string;
  label: string;
  description: string;
  transportKind: 'direct' | 'ssh';
  directTargetUrl: string;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  sshHostKeySha256: string;
  sshRemoteHost: string;
  sshRemotePort: string;
  sshRemoteProtocol: 'http' | 'https';
  authStrategy: 'none' | 'external_url' | 'iframe';
  authUrl: string;
  workspacesText: string;
};

type ServerFormErrors = Partial<
  Record<
    | 'form'
    | 'label'
    | 'directTargetUrl'
    | 'sshHost'
    | 'sshPort'
    | 'sshUsername'
    | 'sshPrivateKey'
    | 'sshHostKeySha256'
    | 'sshRemotePort'
    | 'authUrl'
    | 'workspacesText',
    string
  >
>;

const stopPointerPropagation: React.PointerEventHandler<HTMLElement> = (event) => {
  event.stopPropagation();
};

const emptyServerForm: ServerFormState = {
  id: '',
  label: '',
  description: '',
  transportKind: 'ssh',
  directTargetUrl: '',
  sshHost: '',
  sshPort: '22',
  sshUsername: '',
  sshPrivateKey: '',
  sshPassphrase: '',
  sshHostKeySha256: '',
  sshRemoteHost: '127.0.0.1',
  sshRemotePort: '8390',
  sshRemoteProtocol: 'http',
  authStrategy: 'none',
  authUrl: '',
  workspacesText: '',
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
  const response = await fetchWithSupabaseAuth(input, init);
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = new Error(extractWidgetCodexErrorMessage(payload, response.status)) as HttpError;
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function extractNestedErrorMessage(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  let current = value.trim();

  for (let index = 0; index < 3; index += 1) {
    try {
      const parsed = JSON.parse(current) as unknown;
      if (isRecord(parsed) && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        current = parsed.error.trim();
        continue;
      }
    } catch {
      return current;
    }
    return current;
  }

  return current;
}

function formatConnectivityError(message: string) {
  const host = message.match(/\bgetaddrinfo\s+ENOTFOUND\s+([^\s"'}]+)/)?.[1];
  if (host) {
    return `Cannot resolve SSH host ${host} from the Widget Codex backend. If this is a Tailscale DNS name, run widget-codex/codex-broker inside that tailnet or use a host the Railway service can resolve.`;
  }

  if (/\bECONNREFUSED\b/.test(message)) {
    return `The Widget Codex backend reached the host, but the target port refused the connection. Check SSH access and the remote Codex app-server port.`;
  }

  if (/\bETIMEDOUT\b/.test(message)) {
    return `The Widget Codex backend timed out reaching the host. Check firewall, Tailscale/backend network membership, and SSH reachability.`;
  }

  return message;
}

function extractWidgetCodexErrorMessage(payload: Record<string, unknown> | null, status: number) {
  const raw = extractNestedErrorMessage(payload?.error);
  return raw ? formatConnectivityError(raw) : `Request failed with status ${status}.`;
}

function normalizeWidgetCodexErrorForDisplay(value: string | null | undefined) {
  const raw = extractNestedErrorMessage(value);
  return raw ? formatConnectivityError(raw) : undefined;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? formatConnectivityError(error.message)
    : fallback;
}

function getWidgetCodexStatusMessage(status: number | undefined, message: string) {
  if (status === 401 || message === 'unauthorized') {
    return 'You are not signed in or this browser session is not authorized to manage Widget Codex servers. Sign in with an allowlisted admin account, then retry.';
  }
  if (status === 403 || message === 'forbidden') {
    return 'This account is signed in but is not allowlisted for Widget Codex server actions.';
  }
  return null;
}

function getWidgetCodexErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const status = (error as HttpError).status;
    const statusMessage = getWidgetCodexStatusMessage(status, error.message);
    if (statusMessage) return statusMessage;
  }
  return getErrorMessage(error, fallback);
}

function isWorkspaceSessionNotFoundError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    (error as HttpError).status === 404 &&
    /workspace session not found/i.test(error.message)
  );
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
    lastError: normalizeWidgetCodexErrorForDisplay(persistedState?.lastError),
  } satisfies PersistedWidgetState;
}

export function deriveWidgetCodexWsUrl(value: string | null, baseHref?: string) {
  if (!value) return null;
  try {
    const fallbackBase = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    const url = new URL(value, baseHref ?? fallbackBase);
    const pageProtocol =
      baseHref !== undefined
        ? new URL(baseHref).protocol
        : typeof window !== 'undefined'
          ? window.location.protocol
          : 'http:';
    const shouldUseSecureWebSocket = pageProtocol === 'https:' || url.protocol === 'https:';

    if (url.protocol === 'http:' || url.protocol === 'ws:') {
      url.protocol = shouldUseSecureWebSocket ? 'wss:' : 'ws:';
    } else if (url.protocol === 'https:' || url.protocol === 'wss:') {
      url.protocol = 'wss:';
    } else {
      return null;
    }

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

function normalizeWorkspaces(value: unknown): WidgetCodexServer['workspaces'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const path = typeof entry.path === 'string' ? entry.path : '';
      const label =
        typeof entry.label === 'string' && entry.label.trim().length > 0
          ? entry.label
          : path.split('/').filter(Boolean).at(-1) || path || 'Workspace';
      const id =
        typeof entry.id === 'string' && entry.id.trim().length > 0
          ? entry.id
          : `workspace-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      return { id, label, path };
    })
    .filter((entry): entry is WidgetCodexServer['workspaces'][number] => Boolean(entry));
}

function normalizeServers(value: unknown): WidgetCodexServer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const id = typeof entry.id === 'string' ? entry.id : '';
      if (!id) return null;
      return {
        id,
        label:
          typeof entry.label === 'string' && entry.label.trim().length > 0
            ? entry.label
            : 'Remote Codex',
        description: typeof entry.description === 'string' ? entry.description : null,
        authStrategy:
          entry.authStrategy === 'external_url' || entry.authStrategy === 'iframe'
            ? entry.authStrategy
            : 'none',
        authState:
          entry.authState === 'login_required' ||
          entry.authState === 'pending' ||
          entry.authState === 'authenticated' ||
          entry.authState === 'expired'
            ? entry.authState
            : 'unknown',
        authUrl: typeof entry.authUrl === 'string' ? entry.authUrl : null,
        transportKind: entry.transportKind === 'direct' ? 'direct' : 'ssh',
        workspaces: normalizeWorkspaces(entry.workspaces),
        createdAt:
          typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
        updatedAt:
          typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
      } satisfies WidgetCodexServer;
    })
    .filter((entry): entry is WidgetCodexServer => Boolean(entry));
}

function parsePort(value: string, fallback: number) {
  const raw = value.trim();
  const parsed = Number(raw || String(fallback));
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : null;
}

function validateServerForm(serverForm: ServerFormState) {
  const errors: ServerFormErrors = {};
  const workspaces = serializeWorkspacesInput(serverForm.workspacesText);

  if (!serverForm.label.trim()) {
    errors.label = 'Add a display name for this server.';
  }

  if (serverForm.transportKind === 'direct') {
    const targetUrl = serverForm.directTargetUrl.trim();
    if (!targetUrl) {
      errors.directTargetUrl = 'Enter the reachable Codex app-server URL.';
    } else {
      try {
        const url = new URL(targetUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          errors.directTargetUrl = 'Use an http:// or https:// URL.';
        }
      } catch {
        errors.directTargetUrl = 'Enter a valid http:// or https:// URL.';
      }
    }
  } else {
    if (!serverForm.sshHost.trim()) {
      errors.sshHost = 'Enter the SSH host, for example a Tailscale DNS name.';
    }
    if (parsePort(serverForm.sshPort, 22) === null) {
      errors.sshPort = 'Use a TCP port from 1 to 65535.';
    }
    if (!serverForm.sshUsername.trim()) {
      errors.sshUsername = 'Enter the SSH username on that host.';
    }
    if (parsePort(serverForm.sshRemotePort, 8390) === null) {
      errors.sshRemotePort = 'Use the port your remote Codex app-server is listening on.';
    }

    const privateKey = serverForm.sshPrivateKey.trim();
    if (!privateKey) {
      errors.sshPrivateKey = 'Paste the private key contents, not the file path.';
    } else if (/^cat\s+/.test(privateKey) || privateKey.startsWith('~/.ssh/')) {
      errors.sshPrivateKey =
        'Run the command in Terminal and paste the output, not the command or path.';
    } else if (
      !privateKey.includes('-----BEGIN OPENSSH PRIVATE KEY-----') ||
      !privateKey.includes('-----END OPENSSH PRIVATE KEY-----')
    ) {
      errors.sshPrivateKey =
        'Paste the full OpenSSH private key block, including the BEGIN and END lines.';
    }

    const hostKey = serverForm.sshHostKeySha256.trim();
    if (!hostKey) {
      errors.sshHostKeySha256 = 'Paste the full remote host key fingerprint.';
    } else if (!/^SHA256:[A-Za-z0-9+/=]+$/.test(hostKey) || hostKey.length < 20) {
      errors.sshHostKeySha256 =
        'Use the full SHA256 host-key fingerprint, for example SHA256:abc123...';
    }
  }

  if (serverForm.authStrategy !== 'none') {
    const authUrl = serverForm.authUrl.trim();
    if (!authUrl) {
      errors.authUrl = 'Enter the login URL for this server.';
    } else {
      try {
        new URL(authUrl);
      } catch {
        errors.authUrl = 'Enter a valid login URL.';
      }
    }
  }

  if (workspaces.length === 0) {
    errors.workspacesText = 'Add at least one workspace as Label|/absolute/path.';
  } else if (workspaces.some((workspace) => !workspace.path.startsWith('/'))) {
    errors.workspacesText =
      'Workspace paths must be absolute paths on the SSH host, for example PRESENT|/Users/you/PRESENT.';
  }

  if (Object.keys(errors).length > 0) {
    errors.form = Object.values(errors).find(Boolean);
  }

  return { errors, workspaces };
}

function fieldErrorClass(error: string | undefined, background = 'bg-surface') {
  return cn(
    'w-full rounded-lg border px-3 py-2 text-sm text-primary outline-none',
    background,
    error ? 'border-danger focus:border-danger' : 'border-default',
  );
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <span className="text-xs text-danger">{children}</span>;
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
  const websocketUrlRef = useRef<string | null>(null);
  const websocketCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = createFallbackId();
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;
  const persistedState = props.state;

  const [state, setState] = useState<PersistedWidgetState>(() =>
    buildInitialState(persistedState, rest),
  );
  const stateRef = useRef(state);
  const [servers, setServers] = useState<WidgetCodexServer[]>([]);
  const [workspaces, setWorkspaces] = useState<WidgetCodexServer['workspaces']>([]);
  const [realtimeUrl, setRealtimeUrl] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(
    () => persistedState?.title ?? rest.title ?? 'Remote Codex',
  );
  const [selectedServerId, setSelectedServerId] = useState(() => persistedState?.serverId ?? '');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    () => persistedState?.remoteWorkspaceId ?? '',
  );
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(() => !(persistedState?.frameUrl ?? rest.frameUrl));
  const [isBusy, setIsBusy] = useState(false);
  const [showRemoteApp, setShowRemoteApp] = useState(false);
  const [turnDraft, setTurnDraft] = useState('');
  const [messages, setMessages] = useState<RemoteCodexMessage[]>([]);
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null);
  const [showServerForm, setShowServerForm] = useState(false);
  const [serverForm, setServerForm] = useState<ServerFormState>(emptyServerForm);
  const [serverFormErrors, setServerFormErrors] = useState<ServerFormErrors>({});

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (websocketCloseTimerRef.current) {
        clearTimeout(websocketCloseTimerRef.current);
        websocketCloseTimerRef.current = null;
      }
      websocketRef.current?.close();
      websocketRef.current = null;
      websocketUrlRef.current = null;
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

  useComponentRegistration(
    messageId,
    'CodexRemoteWidget',
    registryProps,
    contextKey || 'canvas',
    (patch) => {
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
    },
  );

  const persistState = useCallback(
    async (nextState: PersistedWidgetState) => {
      stateRef.current = nextState;
      setState(nextState);
      props.updateState?.(nextState);
      try {
        await ComponentRegistry.update(messageId, nextState);
      } catch {
        /* shape can remount while async updates settle */
      }
    },
    [messageId, props.updateState],
  );

  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? null;
  const displayLastError = normalizeWidgetCodexErrorForDisplay(state.lastError);

  const applySnapshot = useCallback(
    async (snapshot: WidgetCodexSnapshot) => {
      const currentState = stateRef.current;
      const normalizedServers = normalizeServers(snapshot.servers);
      setServers(normalizedServers);
      setRealtimeUrl(snapshot.realtimeUrl);
      const nextServerId =
        snapshot.widgetSession?.serverId ?? currentState.serverId ?? normalizedServers[0]?.id ?? '';
      if (mountedRef.current) {
        setSelectedServerId(nextServerId);
      }
      const server =
        normalizedServers.find((entry) => entry.id === nextServerId) ??
        normalizedServers[0] ??
        null;
      setWorkspaces(server?.workspaces ?? []);
      if (mountedRef.current) {
        setSelectedWorkspaceId(
          snapshot.widgetSession?.remoteWorkspaceId ??
            currentState.remoteWorkspaceId ??
            server?.workspaces[0]?.id ??
            '',
        );
      }
      const nextState: PersistedWidgetState = {
        title: snapshot.widgetSession?.title ?? currentState.title ?? 'Remote Codex',
        subtitle: snapshot.widgetSession?.remoteWorkspacePath ?? currentState.subtitle,
        frameUrl: snapshot.connection?.frameUrl ?? undefined,
        widgetSessionId:
          snapshot.widgetSession?.id ?? currentState.widgetSessionId ?? createWidgetSessionId(),
        workspaceSessionId: currentState.workspaceSessionId,
        remoteSessionId: snapshot.connection?.brokerSessionId ?? currentState.remoteSessionId,
        serverId: snapshot.widgetSession?.serverId ?? (nextServerId || undefined),
        connectionId: snapshot.connection?.id ?? snapshot.widgetSession?.connectionId ?? undefined,
        executorSessionId: currentState.executorSessionId,
        remoteWorkspaceId: snapshot.widgetSession?.remoteWorkspaceId ?? undefined,
        remoteWorkspacePath: snapshot.widgetSession?.remoteWorkspacePath ?? undefined,
        status: snapshot.connection?.status ?? snapshot.widgetSession?.status ?? 'disconnected',
        authState: snapshot.widgetSession?.authState ?? server?.authState ?? 'unknown',
        activeThreadId: snapshot.widgetSession?.activeThreadId ?? undefined,
        lastHeartbeatAt:
          snapshot.connection?.lastHeartbeatAt ??
          snapshot.widgetSession?.lastHeartbeatAt ??
          undefined,
        lastError: normalizeWidgetCodexErrorForDisplay(
          snapshot.connection?.lastError ?? snapshot.widgetSession?.lastError,
        ),
      };
      await persistState(nextState);
      if (mountedRef.current) {
        setDraftTitle(nextState.title ?? 'Remote Codex');
        setIsEditing(!nextState.frameUrl);
      }
    },
    [persistState],
  );
  const applySnapshotRef = useRef(applySnapshot);

  useEffect(() => {
    applySnapshotRef.current = applySnapshot;
  }, [applySnapshot]);

  const loadServers = useCallback(async () => {
    const currentState = stateRef.current;
    const payload = await requestJson<{ realtimeUrl: string | null; servers: WidgetCodexServer[] }>(
      '/api/widget-codex/servers',
    );
    const normalizedServers = normalizeServers(payload.servers);
    setServers(normalizedServers);
    setRealtimeUrl(payload.realtimeUrl);
    const nextServerId = currentState.serverId ?? normalizedServers[0]?.id ?? '';
    if (mountedRef.current) {
      setSelectedServerId(nextServerId);
    }
    const server =
      normalizedServers.find((entry) => entry.id === nextServerId) ?? normalizedServers[0] ?? null;
    setWorkspaces(server?.workspaces ?? []);
    if (mountedRef.current) {
      setSelectedWorkspaceId(currentState.remoteWorkspaceId ?? server?.workspaces[0]?.id ?? '');
    }
  }, []);

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
          : typeof latestTask?.metadata.codexThreadId === 'string' &&
              latestTask.metadata.codexThreadId.trim().length > 0
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
      if (workspaceSessionId) {
        try {
          await requestJson<{ tasks: ResetTaskRun[] }>(
            `/api/reset/workspaces/${encodeURIComponent(workspaceSessionId)}/state`,
          );
        } catch (error) {
          if (!isWorkspaceSessionNotFoundError(error)) throw error;
          workspaceSessionId = undefined;
          await persistState({
            ...state,
            workspaceSessionId: undefined,
            executorSessionId: undefined,
            lastError: undefined,
          });
        }
      }
      if (!workspaceSessionId) {
        const existing = await requestJson<{ workspaces: ResetWorkspaceSession[] }>(
          '/api/reset/workspaces',
        );
        const existingWorkspace =
          existing.workspaces.find(
            (workspace) => workspace.title === `Widget ${state.widgetSessionId}`,
          ) ?? null;
        if (existingWorkspace) {
          workspaceSessionId = existingWorkspace.id;
        } else {
          const created = await requestJson<{ workspace: ResetWorkspaceSession }>(
            '/api/reset/workspaces',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: `Widget ${state.widgetSessionId ?? createWidgetSessionId()}`,
                ownerUserId: 'widget-codex',
                workspacePath: connection.remoteWorkspacePath || undefined,
              }),
            },
          );
          workspaceSessionId = created.workspace.id;
        }
      }

      const result = await requestJson<{ executorSession: ResetExecutorSession }>(
        '/api/reset/executors/register',
        {
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
        },
      );

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
    const wsUrl = deriveWidgetCodexWsUrl(realtimeUrl);
    if (!wsUrl || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    const url = new URL(wsUrl);
    if (state.widgetSessionId) {
      url.searchParams.set('widgetSessionId', state.widgetSessionId);
    }
    const nextUrl = url.toString();
    if (websocketCloseTimerRef.current) {
      clearTimeout(websocketCloseTimerRef.current);
      websocketCloseTimerRef.current = null;
    }
    if (websocketRef.current && websocketUrlRef.current === nextUrl) {
      return;
    }
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
      websocketUrlRef.current = null;
    }
    const socket = new WebSocket(url);
    websocketRef.current = socket;
    websocketUrlRef.current = nextUrl;

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; payload?: WidgetCodexSnapshot };
        if (payload.type === 'snapshot' && payload.payload) {
          void applySnapshotRef.current(payload.payload);
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
      websocketCloseTimerRef.current = setTimeout(() => {
        if (websocketRef.current === socket) {
          socket.close();
          websocketRef.current = null;
          websocketUrlRef.current = null;
        }
        websocketCloseTimerRef.current = null;
      }, 250);
    };
  }, [realtimeUrl, state.widgetSessionId]);

  const saveServer = useCallback(async () => {
    const validation = validateServerForm(serverForm);
    setServerFormErrors(validation.errors);
    if (validation.errors.form) {
      setState((previous) => ({
        ...previous,
        lastError: validation.errors.form,
      }));
      return;
    }

    const sshPort = parsePort(serverForm.sshPort, 22) ?? 22;
    const remotePort = parsePort(serverForm.sshRemotePort, 8390) ?? 8390;
    const workspacesPayload = validation.workspaces;
    const sshPayload =
      serverForm.transportKind === 'ssh'
        ? {
            host: serverForm.sshHost.trim(),
            port: sshPort,
            username: serverForm.sshUsername.trim(),
            remoteHost: serverForm.sshRemoteHost.trim() || '127.0.0.1',
            remotePort,
            remoteProtocol: serverForm.sshRemoteProtocol,
            hostKeySha256: serverForm.sshHostKeySha256.trim(),
            privateKey: serverForm.sshPrivateKey.trim() || null,
            passphrase: serverForm.sshPassphrase.trim() || null,
          }
        : null;
    const baseBody = {
      label: serverForm.label.trim(),
      description: serverForm.description.trim() || null,
      authStrategy: serverForm.authStrategy,
      authUrl: serverForm.authUrl.trim() || null,
      transportKind: serverForm.transportKind,
      workspaces: workspacesPayload,
    };
    setIsBusy(true);
    try {
      if (serverForm.id) {
        const body = {
          ...baseBody,
          ...(serverForm.transportKind === 'direct' && serverForm.directTargetUrl.trim()
            ? { directTargetUrl: serverForm.directTargetUrl.trim() }
            : {}),
          ...(serverForm.transportKind === 'ssh' &&
          sshPayload?.host &&
          sshPayload.username &&
          sshPayload.privateKey
            ? { ssh: sshPayload }
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
          ...(serverForm.transportKind === 'direct'
            ? { directTargetUrl: serverForm.directTargetUrl.trim() }
            : { ssh: sshPayload }),
        };
        await requestJson('/api/widget-codex/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      setShowServerForm(false);
      setServerForm(emptyServerForm);
      setServerFormErrors({});
      await loadServers();
    } catch (error) {
      const message = getWidgetCodexErrorMessage(error, 'Failed to save Widget Codex server.');
      setServerFormErrors({ form: message });
      setState((previous) => ({
        ...previous,
        lastError: message,
      }));
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [loadServers, serverForm]);

  const editServer = useCallback(() => {
    if (!selectedServer) return;
    const selectedWorkspaces = normalizeWorkspaces(selectedServer.workspaces);
    setServerForm({
      id: selectedServer.id,
      label: selectedServer.label,
      description: selectedServer.description ?? '',
      transportKind: selectedServer.transportKind,
      directTargetUrl: '',
      sshHost: '',
      sshPort: '22',
      sshUsername: '',
      sshPrivateKey: '',
      sshPassphrase: '',
      sshHostKeySha256: '',
      sshRemoteHost: '127.0.0.1',
      sshRemotePort: '8390',
      sshRemoteProtocol: 'http',
      authStrategy: selectedServer.authStrategy,
      authUrl: selectedServer.authUrl ?? '',
      workspacesText: workspacesToInput(selectedWorkspaces),
    });
    setServerFormErrors({});
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
      await requestJson(
        `/api/widget-codex/servers/${encodeURIComponent(selectedServerId)}/auth/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetSessionId: state.widgetSessionId ?? createWidgetSessionId(),
            remoteWorkspaceId: selectedWorkspaceId || undefined,
            remoteWorkspacePath:
              workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.path ??
              undefined,
          }),
        },
      );
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
            lastError: getErrorMessage(
              bindingError,
              'Connected, but widget executor binding is still pending.',
            ),
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
        lastError: normalizeWidgetCodexErrorForDisplay(payload.connection.lastError),
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
      if (isWorkspaceSessionNotFoundError(error)) {
        void persistState({
          ...stateRef.current,
          workspaceSessionId: undefined,
          executorSessionId: undefined,
          lastError: undefined,
        });
        setMessages([]);
        setActiveTaskRunId(null);
        return;
      }
      setState((previous) => ({
        ...previous,
        lastError: getErrorMessage(error, 'Failed to load widget Codex conversation.'),
      }));
    });
  }, [loadWorkspaceConversation, persistState, state.workspaceSessionId]);

  useEffect(() => {
    if (
      !state.frameUrl ||
      !state.connectionId ||
      state.workspaceSessionId ||
      !state.widgetSessionId
    )
      return;
    const connection =
      state.frameUrl && state.remoteWorkspacePath
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
      void requestJson<{ taskRun: ResetTaskRun }>(
        `/api/reset/turns?taskRunId=${encodeURIComponent(activeTaskRunId)}`,
      )
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
    const nextWorkspaces = normalizeWorkspaces(selectedServer.workspaces);
    setWorkspaces(nextWorkspaces);
    if (!selectedWorkspaceId && nextWorkspaces[0]?.id) {
      setSelectedWorkspaceId(nextWorkspaces[0].id);
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
        'flex min-h-full w-full flex-col gap-3 rounded-[24px] border border-[var(--color-divider)] bg-[var(--color-panel)] p-3',
        className,
      )}
    >
      {state.frameUrl ? (
        <div className="flex min-h-full flex-col gap-3 rounded-[20px] border border-default bg-surface p-3">
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
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => void refreshConnection()}
              >
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => setIsEditing(true)}
              >
                Manage
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => void disconnectRemoteCodex()}
              >
                Disconnect
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => setShowRemoteApp((value) => !value)}
              >
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
            {displayLastError ? (
              <div className="text-danger">Last error: {displayLastError}</div>
            ) : null}
          </div>

          {isEditing ? (
            <div className="rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-xs text-secondary">
              The connection is live. Disconnect if you need to reconfigure the server or workspace
              selection.
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
                  Send a prompt here to use the widget as a native Remote Codex client. The remote
                  app iframe is optional now.
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
                  Secondary remote app surface. The primary widget interaction path stays native
                  in-canvas.
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
        <div className="flex min-h-full flex-col gap-3 rounded-[20px] border border-dashed border-[var(--color-divider)] bg-[var(--color-muted)]/30 p-4">
          <div>
            <p className="text-sm font-semibold text-primary">Remote Codex</p>
            <p className="mt-1 text-xs text-secondary">
              Litter-style widget sub-stack: saved servers, login handoff, remote workspace
              selection, and live connection state.
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
                <option value="">
                  {workspaces.length ? 'Select a workspace' : 'No workspaces yet'}
                </option>
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
            {state.lastHeartbeatAt ? (
              <div>Last heartbeat: {new Date(state.lastHeartbeatAt).toLocaleString()}</div>
            ) : null}
            {displayLastError ? (
              <div className="text-danger">Last error: {displayLastError}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onPointerDown={stopPointerPropagation}
              onClick={() => {
                setServerFormErrors({});
                setShowServerForm((value) => !value);
              }}
            >
              {showServerForm ? 'Hide Server Form' : 'Add Server'}
            </Button>
            {selectedServer ? (
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={editServer}
              >
                Edit Server
              </Button>
            ) : null}
            {selectedServer ? (
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => void deleteServer()}
              >
                Delete Server
              </Button>
            ) : null}
            {selectedServer && selectedServer.authStrategy !== 'none' ? (
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => void startAuth()}
              >
                Open Login
              </Button>
            ) : null}
            {selectedServer &&
            selectedServer.authStrategy !== 'none' &&
            (loginUrl || selectedServer.authState === 'pending') ? (
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => void completeAuth()}
              >
                Close Login Helper
              </Button>
            ) : null}
          </div>

          {showServerForm ? (
            <div className="grid gap-3 rounded-xl border border-default bg-surface p-3">
              {serverFormErrors.form ? (
                <div
                  className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
                  role="alert"
                >
                  {serverFormErrors.form}
                </div>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Server Label</span>
                <input
                  value={serverForm.label}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) =>
                    setServerForm((previous) => ({ ...previous, label: event.target.value }))
                  }
                  className={fieldErrorClass(serverFormErrors.label, 'bg-[var(--color-panel)]')}
                  placeholder="Remote Codex Prod"
                />
                <FieldError>{serverFormErrors.label}</FieldError>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Description</span>
                <input
                  value={serverForm.description}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) =>
                    setServerForm((previous) => ({ ...previous, description: event.target.value }))
                  }
                  className="w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                  placeholder="Primary remote Codex app"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Connection Type</span>
                <select
                  value={serverForm.transportKind}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) =>
                    setServerForm((previous) => ({
                      ...previous,
                      transportKind: event.target.value as 'direct' | 'ssh',
                    }))
                  }
                  className="w-full rounded-lg border border-default bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none"
                >
                  <option value="ssh">SSH tunnel to remote Codex</option>
                  <option value="direct">Direct Codex app URL</option>
                </select>
              </label>
              {serverForm.transportKind === 'direct' ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-secondary">Direct Target URL</span>
                  <input
                    value={serverForm.directTargetUrl}
                    onPointerDown={stopPointerPropagation}
                    onChange={(event) =>
                      setServerForm((previous) => ({
                        ...previous,
                        directTargetUrl: event.target.value,
                      }))
                    }
                    className={fieldErrorClass(
                      serverFormErrors.directTargetUrl,
                      'bg-[var(--color-panel)]',
                    )}
                    placeholder="https://remote-codex.example/"
                  />
                  <FieldError>{serverFormErrors.directTargetUrl}</FieldError>
                </label>
              ) : (
                <div className="grid gap-3 rounded-lg border border-default bg-[var(--color-panel)] p-3">
                  <div className="text-xs text-secondary">
                    SSH credentials are sent to the widget service only. They are not stored in
                    TLDraw shape state or returned by list APIs.
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-secondary">SSH Host</span>
                      <input
                        value={serverForm.sshHost}
                        onPointerDown={stopPointerPropagation}
                        onChange={(event) =>
                          setServerForm((previous) => ({
                            ...previous,
                            sshHost: event.target.value,
                          }))
                        }
                        className={fieldErrorClass(serverFormErrors.sshHost)}
                        placeholder="codex-box.tailnet.ts.net"
                      />
                      <FieldError>{serverFormErrors.sshHost}</FieldError>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-secondary">SSH Port</span>
                      <input
                        value={serverForm.sshPort}
                        onPointerDown={stopPointerPropagation}
                        onChange={(event) =>
                          setServerForm((previous) => ({
                            ...previous,
                            sshPort: event.target.value,
                          }))
                        }
                        className={fieldErrorClass(serverFormErrors.sshPort)}
                        placeholder="22"
                      />
                      <FieldError>{serverFormErrors.sshPort}</FieldError>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-secondary">SSH Username</span>
                      <input
                        value={serverForm.sshUsername}
                        onPointerDown={stopPointerPropagation}
                        onChange={(event) =>
                          setServerForm((previous) => ({
                            ...previous,
                            sshUsername: event.target.value,
                          }))
                        }
                        className={fieldErrorClass(serverFormErrors.sshUsername)}
                        placeholder="bsteinher"
                      />
                      <FieldError>{serverFormErrors.sshUsername}</FieldError>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-secondary">Remote Codex Port</span>
                      <input
                        value={serverForm.sshRemotePort}
                        onPointerDown={stopPointerPropagation}
                        onChange={(event) =>
                          setServerForm((previous) => ({
                            ...previous,
                            sshRemotePort: event.target.value,
                          }))
                        }
                        className={fieldErrorClass(serverFormErrors.sshRemotePort)}
                        placeholder="8390"
                      />
                      <FieldError>{serverFormErrors.sshRemotePort}</FieldError>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-secondary">SSH Private Key</span>
                    <textarea
                      value={serverForm.sshPrivateKey}
                      onPointerDown={stopPointerPropagation}
                      onChange={(event) =>
                        setServerForm((previous) => ({
                          ...previous,
                          sshPrivateKey: event.target.value,
                        }))
                      }
                      className={cn(
                        'min-h-24 w-full rounded-lg border bg-surface px-3 py-2 font-mono text-xs text-primary outline-none',
                        serverFormErrors.sshPrivateKey
                          ? 'border-danger focus:border-danger'
                          : 'border-default',
                      )}
                      placeholder={`-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----`}
                    />
                    <FieldError>{serverFormErrors.sshPrivateKey}</FieldError>
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-secondary">Key Passphrase</span>
                      <input
                        value={serverForm.sshPassphrase}
                        type="password"
                        onPointerDown={stopPointerPropagation}
                        onChange={(event) =>
                          setServerForm((previous) => ({
                            ...previous,
                            sshPassphrase: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none"
                        placeholder="optional"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-secondary">Host Key SHA256</span>
                      <input
                        value={serverForm.sshHostKeySha256}
                        onPointerDown={stopPointerPropagation}
                        onChange={(event) =>
                          setServerForm((previous) => ({
                            ...previous,
                            sshHostKeySha256: event.target.value,
                          }))
                        }
                        className={fieldErrorClass(serverFormErrors.sshHostKeySha256)}
                        placeholder="SHA256:hg21+tjDwXo3cYyAxc23NHw2g2PLOaWgh6KHORwfvow"
                      />
                      <FieldError>{serverFormErrors.sshHostKeySha256}</FieldError>
                    </label>
                  </div>
                </div>
              )}
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
                    onChange={(event) =>
                      setServerForm((previous) => ({ ...previous, authUrl: event.target.value }))
                    }
                    className={fieldErrorClass(serverFormErrors.authUrl, 'bg-[var(--color-panel)]')}
                    placeholder="https://remote-codex.example/login"
                  />
                  <FieldError>{serverFormErrors.authUrl}</FieldError>
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-secondary">Workspaces</span>
                <textarea
                  value={serverForm.workspacesText}
                  onPointerDown={stopPointerPropagation}
                  onChange={(event) =>
                    setServerForm((previous) => ({
                      ...previous,
                      workspacesText: event.target.value,
                    }))
                  }
                  className={cn(
                    'min-h-28 w-full rounded-lg border bg-[var(--color-panel)] px-3 py-2 text-sm text-primary outline-none',
                    serverFormErrors.workspacesText
                      ? 'border-danger focus:border-danger'
                      : 'border-default',
                  )}
                  placeholder={`PRESENT|/Users/you/PRESENT\nLitter|/Users/you/litter`}
                />
                <FieldError>{serverFormErrors.workspacesText}</FieldError>
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onPointerDown={stopPointerPropagation}
                  onClick={() => void saveServer()}
                  disabled={isBusy}
                >
                  {isBusy ? 'Saving...' : serverForm.id ? 'Save Server' : 'Create Server'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPointerDown={stopPointerPropagation}
                  onClick={() => {
                    setShowServerForm(false);
                    setServerForm(emptyServerForm);
                    setServerFormErrors({});
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
                Use this as a login handoff helper. The widget does not claim server-side auth proof
                until a real callback flow exists.
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
              {isBusy
                ? 'Working...'
                : state.connectionId
                  ? 'Reconnect Remote Codex'
                  : 'Connect Remote Codex'}
            </Button>
            {state.connectionId ? (
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => void disconnectRemoteCodex()}
              >
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
