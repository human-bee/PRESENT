import type {
  WidgetCodexCreateConnectionInput,
  WidgetCodexPublicConnection,
  WidgetCodexPublicServer,
  WidgetCodexSnapshot,
} from './service';
import type { WidgetCodexWorkspace } from './contracts';

export class WidgetCodexResponseError extends Error {
  readonly status: number;

  readonly body: string;

  constructor(status: number, body: string) {
    super(body || `Widget Codex request failed (${status}).`);
    this.name = 'WidgetCodexResponseError';
    this.status = status;
    this.body = body;
  }
}

const resolveWidgetCodexBaseUrl = () => {
  const explicit = process.env.WIDGET_CODEX_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = process.env.WIDGET_CODEX_PORT?.trim() || '4102';
  return `http://127.0.0.1:${port}`;
};

async function widgetCodexRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${resolveWidgetCodexBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new WidgetCodexResponseError(response.status, text);
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export async function listWidgetCodexServers() {
  return widgetCodexRequest<{ realtimeUrl: string | null; servers: WidgetCodexPublicServer[] }>('/servers');
}

export async function createWidgetCodexServer(input: {
  label: string;
  description?: string | null;
  authStrategy?: 'none' | 'external_url' | 'iframe';
  authUrl?: string | null;
  directTargetUrl: string;
  workspaces?: WidgetCodexWorkspace[];
}) {
  return widgetCodexRequest<{ server: WidgetCodexPublicServer }>('/servers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWidgetCodexServer(
  serverId: string,
  input: Partial<{
    label: string;
    description: string | null;
    authStrategy: 'none' | 'external_url' | 'iframe';
    authUrl: string | null;
    directTargetUrl: string;
    workspaces: WidgetCodexWorkspace[];
  }>,
) {
  return widgetCodexRequest<{ server: WidgetCodexPublicServer }>(`/servers/${encodeURIComponent(serverId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteWidgetCodexServer(serverId: string) {
  return widgetCodexRequest<{ deleted: boolean }>(`/servers/${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
  });
}

export async function startWidgetCodexAuth(serverId: string) {
  return widgetCodexRequest<{ authState: string; loginUrl: string | null }>(
    `/servers/${encodeURIComponent(serverId)}/auth/start`,
    { method: 'POST' },
  );
}

export async function completeWidgetCodexAuth(
  serverId: string,
  input: {
    widgetSessionId?: string;
    remoteWorkspaceId?: string;
    remoteWorkspacePath?: string;
  } = {},
) {
  return widgetCodexRequest<{ server: WidgetCodexPublicServer }>(
    `/servers/${encodeURIComponent(serverId)}/auth/complete`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function listWidgetCodexWorkspaces(serverId: string) {
  return widgetCodexRequest<{ workspaces: WidgetCodexWorkspace[] }>(
    `/servers/${encodeURIComponent(serverId)}/workspaces`,
  );
}

export async function createWidgetCodexConnection(input: WidgetCodexCreateConnectionInput) {
  return widgetCodexRequest<{
    widgetSession: WidgetCodexSnapshot['widgetSession'];
    connection: WidgetCodexPublicConnection | null;
  }>('/connections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getWidgetCodexConnection(connectionId: string) {
  return widgetCodexRequest<{ connection: WidgetCodexPublicConnection }>(
    `/connections/${encodeURIComponent(connectionId)}`,
  );
}

export async function deleteWidgetCodexConnection(connectionId: string) {
  return widgetCodexRequest<{ deleted: boolean }>(`/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
  });
}

export async function getWidgetCodexSnapshot(widgetSessionId: string) {
  return widgetCodexRequest<WidgetCodexSnapshot>(`/widgets/${encodeURIComponent(widgetSessionId)}`);
}
