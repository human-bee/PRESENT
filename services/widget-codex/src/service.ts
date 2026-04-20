import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  createCodexBrokerSession,
  deleteCodexBrokerSession,
  getCodexBrokerSession,
} from '@present/codex-broker/client';
import { codexBrokerTransportSchema, type CreateCodexBrokerSessionInput } from '@present/codex-broker/service';
import type { CodexBrokerSessionSnapshot } from '@present/codex-broker/session-store';
import {
  widgetCodexAuthStateSchema,
  widgetCodexAuthStrategySchema,
  widgetCodexConnectionStatusSchema,
  widgetCodexCreateConnectionInputSchema,
  widgetCodexServerInputSchema,
  widgetCodexServerPatchSchema,
  widgetCodexWorkspaceSchema,
} from './contracts';

const widgetCodexServerInternalSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable(),
  authStrategy: widgetCodexAuthStrategySchema,
  authState: widgetCodexAuthStateSchema,
  authUrl: z.string().url().nullable(),
  transport: codexBrokerTransportSchema,
  workspaces: z.array(widgetCodexWorkspaceSchema).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const widgetCodexWidgetSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  serverId: z.string().nullable(),
  connectionId: z.string().nullable(),
  remoteWorkspaceId: z.string().nullable(),
  remoteWorkspacePath: z.string().nullable(),
  status: widgetCodexConnectionStatusSchema,
  authState: widgetCodexAuthStateSchema,
  activeThreadId: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const widgetCodexConnectionRecordSchema = z.object({
  id: z.string().min(1),
  widgetSessionId: z.string().min(1),
  serverId: z.string().min(1),
  brokerSessionId: z.string().min(1),
  remoteWorkspaceId: z.string().nullable(),
  remoteWorkspacePath: z.string().min(1),
  frameUrl: z.string().url(),
  proxyBaseUrl: z.string().url(),
  status: widgetCodexConnectionStatusSchema,
  authState: widgetCodexAuthStateSchema,
  lastHeartbeatAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const widgetCodexStateSchema = z.object({
  schemaVersion: z.literal(1),
  servers: z.array(widgetCodexServerInternalSchema).default([]),
  widgetSessions: z.array(widgetCodexWidgetSessionSchema).default([]),
  connections: z.array(widgetCodexConnectionRecordSchema).default([]),
});

const publicServerSchema = widgetCodexServerInternalSchema.omit({ transport: true });
const publicConnectionSchema = widgetCodexConnectionRecordSchema;
const publicWidgetSessionSchema = widgetCodexWidgetSessionSchema;

export const widgetCodexDefaultServerSchema = widgetCodexServerInternalSchema.extend({
  id: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
});

export type WidgetCodexAuthState = z.infer<typeof widgetCodexAuthStateSchema>;
export type WidgetCodexConnectionStatus = z.infer<typeof widgetCodexConnectionStatusSchema>;
export type WidgetCodexPublicServer = z.infer<typeof publicServerSchema>;
export type WidgetCodexPublicConnection = z.infer<typeof publicConnectionSchema>;
export type WidgetCodexPublicWidgetSession = z.infer<typeof publicWidgetSessionSchema>;
export type WidgetCodexCreateConnectionInput = z.infer<typeof widgetCodexCreateConnectionInputSchema>;

export type WidgetCodexSnapshot = {
  realtimeUrl: string | null;
  servers: WidgetCodexPublicServer[];
  widgetSession: WidgetCodexPublicWidgetSession | null;
  connection: WidgetCodexPublicConnection | null;
};

type WidgetCodexState = z.infer<typeof widgetCodexStateSchema>;
type WidgetCodexServerInternal = z.infer<typeof widgetCodexServerInternalSchema>;
type WidgetCodexWidgetSession = z.infer<typeof widgetCodexWidgetSessionSchema>;
type WidgetCodexConnectionRecord = z.infer<typeof widgetCodexConnectionRecordSchema>;

type BrokerClient = {
  createSession: (input: CreateCodexBrokerSessionInput) => Promise<{ session: CodexBrokerSessionSnapshot }>;
  getSession: (sessionId: string) => Promise<{ session: CodexBrokerSessionSnapshot }>;
  deleteSession: (sessionId: string) => Promise<{ deleted: boolean }>;
};

export type WidgetCodexServiceConfig = {
  stateFilePath?: string | null;
  defaultServers?: Array<z.infer<typeof widgetCodexDefaultServerSchema>>;
  realtimeUrl?: string | null;
  broker?: BrokerClient;
};

const DEFAULT_STATE_DIR = path.join(process.cwd(), '.present-data', 'widget-codex');
const DEFAULT_STATE_FILE = path.join(DEFAULT_STATE_DIR, 'state.json');

const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

const nowIso = () => new Date().toISOString();

const defaultBrokerClient: BrokerClient = {
  createSession: createCodexBrokerSession,
  getSession: getCodexBrokerSession,
  deleteSession: deleteCodexBrokerSession,
};

const toPublicServer = (server: WidgetCodexServerInternal) =>
  publicServerSchema.parse({
    ...server,
  });

const toPublicConnection = (connection: WidgetCodexConnectionRecord | null) =>
  connection ? publicConnectionSchema.parse(connection) : null;

const toPublicWidgetSession = (widgetSession: WidgetCodexWidgetSession | null) =>
  widgetSession ? publicWidgetSessionSchema.parse(widgetSession) : null;

function normalizeDefaultServer(input: z.infer<typeof widgetCodexDefaultServerSchema>): WidgetCodexServerInternal {
  const timestamp = nowIso();
  return widgetCodexServerInternalSchema.parse({
    id: input.id ?? createId('wcsrv'),
    label: input.label,
    description: input.description ?? null,
    authStrategy: input.authStrategy,
    authState:
      input.authState ??
      (input.authStrategy === 'none' ? 'authenticated' : input.authUrl ? 'login_required' : 'unknown'),
    authUrl: input.authUrl ?? null,
    transport: input.transport,
    workspaces: input.workspaces ?? [],
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  });
}

async function ensureStateFile(stateFilePath: string) {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  try {
    await fs.access(stateFilePath);
  } catch {
    await fs.writeFile(stateFilePath, JSON.stringify(widgetCodexStateSchema.parse({ schemaVersion: 1 }), null, 2), 'utf8');
  }
}

export class WidgetCodexService {
  private readonly stateFilePath: string;

  private readonly realtimeUrl: string | null;

  private readonly broker: BrokerClient;

  private readonly events = new EventEmitter();

  private state: WidgetCodexState = widgetCodexStateSchema.parse({ schemaVersion: 1 });

  private hydrated = false;

  constructor(config: WidgetCodexServiceConfig = {}) {
    this.stateFilePath = config.stateFilePath?.trim() || DEFAULT_STATE_FILE;
    this.realtimeUrl = config.realtimeUrl?.trim() || null;
    this.broker = config.broker ?? defaultBrokerClient;
    if (config.defaultServers?.length) {
      this.state = widgetCodexStateSchema.parse({
        ...this.state,
        servers: config.defaultServers.map(normalizeDefaultServer),
      });
    }
  }

  private async saveState() {
    await ensureStateFile(this.stateFilePath);
    await fs.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  async hydrate() {
    if (this.hydrated) return;
    await ensureStateFile(this.stateFilePath);
    const raw = await fs.readFile(this.stateFilePath, 'utf8');
    const parsed = widgetCodexStateSchema.parse(JSON.parse(raw));
    const mergedServers = [...parsed.servers];
    for (const server of this.state.servers) {
      if (mergedServers.some((entry) => entry.id === server.id)) continue;
      mergedServers.push(server);
    }
    this.state = widgetCodexStateSchema.parse({
      ...parsed,
      servers: mergedServers,
    });
    this.hydrated = true;
    await this.saveState();
  }

  subscribe(listener: (snapshot: WidgetCodexSnapshot) => void) {
    this.events.on('snapshot', listener);
    return () => {
      this.events.off('snapshot', listener);
    };
  }

  private emitSnapshot(widgetSessionId?: string | null) {
    const snapshot = this.getSnapshot(widgetSessionId ?? null);
    this.events.emit('snapshot', snapshot);
  }

  getSnapshot(widgetSessionId: string | null): WidgetCodexSnapshot {
    const widgetSession = widgetSessionId
      ? this.state.widgetSessions.find((entry) => entry.id === widgetSessionId) ?? null
      : null;
    const connection = widgetSession?.connectionId
      ? this.state.connections.find((entry) => entry.id === widgetSession.connectionId) ?? null
      : null;
    return {
      realtimeUrl: this.realtimeUrl,
      servers: this.state.servers.map(toPublicServer),
      widgetSession: toPublicWidgetSession(widgetSession),
      connection: toPublicConnection(connection),
    };
  }

  listServers() {
    return this.state.servers.map(toPublicServer);
  }

  private resolveServer(serverId: string) {
    return this.state.servers.find((server) => server.id === serverId) ?? null;
  }

  private resolveWidgetSession(widgetSessionId: string) {
    return this.state.widgetSessions.find((entry) => entry.id === widgetSessionId) ?? null;
  }

  private resolveConnection(connectionId: string) {
    return this.state.connections.find((entry) => entry.id === connectionId) ?? null;
  }

  async createServer(input: z.infer<typeof widgetCodexServerInputSchema>) {
    await this.hydrate();
    const payload = widgetCodexServerInputSchema.parse(input);
    const server = widgetCodexServerInternalSchema.parse({
      id: createId('wcsrv'),
      label: payload.label.trim(),
      description: payload.description?.trim() || null,
      authStrategy: payload.authStrategy,
      authState: payload.authStrategy === 'none' ? 'authenticated' : payload.authUrl ? 'login_required' : 'unknown',
      authUrl: payload.authUrl?.trim() || null,
      transport: {
        directTargetUrl: payload.directTargetUrl,
      },
      workspaces: payload.workspaces,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      servers: [server, ...this.state.servers],
    });
    await this.saveState();
    this.emitSnapshot(null);
    return toPublicServer(server);
  }

  async updateServer(serverId: string, input: z.infer<typeof widgetCodexServerPatchSchema>) {
    await this.hydrate();
    const current = this.resolveServer(serverId);
    if (!current) return null;
    const patch = widgetCodexServerPatchSchema.parse(input);
    const next = widgetCodexServerInternalSchema.parse({
      ...current,
      label: patch.label?.trim() || current.label,
      description:
        patch.description === undefined ? current.description : patch.description?.trim() || null,
      authStrategy: patch.authStrategy ?? current.authStrategy,
      authState:
        (patch.authStrategy ?? current.authStrategy) === 'none'
          ? 'authenticated'
          : patch.authStrategy !== undefined || patch.authUrl !== undefined
            ? ((patch.authUrl === undefined ? current.authUrl : patch.authUrl?.trim() || null)
                ? 'login_required'
                : 'unknown')
            : current.authState,
      authUrl: patch.authUrl === undefined ? current.authUrl : patch.authUrl?.trim() || null,
      transport:
        patch.directTargetUrl === undefined
          ? current.transport
          : {
              directTargetUrl: patch.directTargetUrl,
            },
      workspaces: patch.workspaces ?? current.workspaces,
      updatedAt: nowIso(),
    });
    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      servers: this.state.servers.map((server) => (server.id === serverId ? next : server)),
    });
    await this.saveState();
    this.emitSnapshot(null);
    return toPublicServer(next);
  }

  async deleteServer(serverId: string) {
    await this.hydrate();
    const current = this.resolveServer(serverId);
    if (!current) return false;
    const relatedConnections = this.state.connections.filter((connection) => connection.serverId === serverId);
    for (const connection of relatedConnections) {
      await this.deleteConnection(connection.id);
    }
    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      servers: this.state.servers.filter((server) => server.id !== serverId),
      widgetSessions: this.state.widgetSessions.map((session) =>
        session.serverId === serverId
          ? {
              ...session,
              serverId: null,
              connectionId: null,
              status: 'disconnected',
              authState: 'unknown',
              lastError: null,
              updatedAt: nowIso(),
            }
          : session,
      ),
    });
    await this.saveState();
    this.emitSnapshot(null);
    return true;
  }

  listWorkspaces(serverId: string) {
    const server = this.resolveServer(serverId);
    if (!server) return null;
    return server.workspaces;
  }

  async startAuth(serverId: string) {
    await this.hydrate();
    const server = this.resolveServer(serverId);
    if (!server) return null;
    const authState: WidgetCodexAuthState =
      server.authStrategy === 'none' ? 'authenticated' : server.authUrl ? 'pending' : 'unknown';
    const next = {
      ...server,
      authState,
      updatedAt: nowIso(),
    };
    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      servers: this.state.servers.map((entry) => (entry.id === serverId ? next : entry)),
    });
    await this.saveState();
    this.emitSnapshot(null);
    return {
      authState,
      loginUrl: server.authUrl,
    };
  }

  async completeAuth(serverId: string) {
    await this.hydrate();
    const server = this.resolveServer(serverId);
    if (!server) return null;
    const next = {
      ...server,
      authState:
        server.authStrategy === 'none' ? ('authenticated' as const) : server.authUrl ? ('login_required' as const) : ('unknown' as const),
      updatedAt: nowIso(),
    };
    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      servers: this.state.servers.map((entry) => (entry.id === serverId ? next : entry)),
    });
    await this.saveState();
    this.emitSnapshot(null);
    return toPublicServer(next);
  }

  private upsertWidgetSession(input: {
    widgetSessionId?: string;
    title?: string;
    serverId?: string | null;
    connectionId?: string | null;
    remoteWorkspaceId?: string | null;
    remoteWorkspacePath?: string | null;
    status: WidgetCodexConnectionStatus;
    authState: WidgetCodexAuthState;
    lastHeartbeatAt?: string | null;
    lastError?: string | null;
  }) {
    const existing =
      input.widgetSessionId && this.resolveWidgetSession(input.widgetSessionId)
        ? this.resolveWidgetSession(input.widgetSessionId!)
        : null;
    const timestamp = nowIso();
    const widgetSession = widgetCodexWidgetSessionSchema.parse({
      id: existing?.id ?? input.widgetSessionId ?? createId('wcws'),
      title: input.title?.trim() || existing?.title || 'Remote Codex',
      serverId: input.serverId ?? existing?.serverId ?? null,
      connectionId: input.connectionId ?? existing?.connectionId ?? null,
      remoteWorkspaceId: input.remoteWorkspaceId ?? existing?.remoteWorkspaceId ?? null,
      remoteWorkspacePath: input.remoteWorkspacePath ?? existing?.remoteWorkspacePath ?? null,
      status: input.status,
      authState: input.authState,
      activeThreadId: existing?.activeThreadId ?? null,
      lastHeartbeatAt: input.lastHeartbeatAt ?? existing?.lastHeartbeatAt ?? null,
      lastError: input.lastError ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      widgetSessions: [
        widgetSession,
        ...this.state.widgetSessions.filter((entry) => entry.id !== widgetSession.id),
      ],
    });
    return widgetSession;
  }

  async createConnection(input: WidgetCodexCreateConnectionInput) {
    await this.hydrate();
    const payload = widgetCodexCreateConnectionInputSchema.parse(input);
    const server = this.resolveServer(payload.serverId);
    if (!server) {
      throw new Error('Widget Codex server not found.');
    }
    const workspace =
      (payload.remoteWorkspaceId
        ? server.workspaces.find((entry) => entry.id === payload.remoteWorkspaceId)
        : null) ??
      (payload.remoteWorkspacePath
        ? server.workspaces.find((entry) => entry.path === payload.remoteWorkspacePath)
        : null) ??
      server.workspaces[0] ??
      (payload.remoteWorkspacePath
        ? {
            id: createId('wcwsp'),
            label: payload.remoteWorkspacePath.split('/').filter(Boolean).at(-1) ?? payload.remoteWorkspacePath,
            path: payload.remoteWorkspacePath,
          }
        : null);

    if (!workspace) {
      throw new Error('Server does not expose any remote workspaces yet.');
    }

    const widgetSession = this.upsertWidgetSession({
      widgetSessionId: payload.widgetSessionId,
      title: payload.title,
      serverId: server.id,
      connectionId: null,
      remoteWorkspaceId: workspace.id,
      remoteWorkspacePath: workspace.path,
      status: 'connecting',
      authState: server.authStrategy === 'none' ? 'authenticated' : server.authState,
      lastError: null,
    });

    if (widgetSession.connectionId) {
      await this.deleteConnection(widgetSession.connectionId);
    }

    const { session } = await this.broker.createSession({
      workspaceSessionId: widgetSession.id,
      remoteWorkingDirectory: workspace.path,
      reconnect: true,
      transport: server.transport,
    });

    const connection = widgetCodexConnectionRecordSchema.parse({
      id: createId('wccx'),
      widgetSessionId: widgetSession.id,
      serverId: server.id,
      brokerSessionId: session.sessionId,
      remoteWorkspaceId: workspace.id,
      remoteWorkspacePath: workspace.path,
      frameUrl: session.frameUrl,
      proxyBaseUrl: session.proxyBaseUrl,
      status: session.status === 'ready' ? 'ready' : 'connecting',
      authState: server.authStrategy === 'none' ? 'authenticated' : server.authState,
      lastHeartbeatAt: session.lastHeartbeatAt ?? null,
      lastError: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      connections: [connection, ...this.state.connections.filter((entry) => entry.id !== connection.id)],
    });
    this.upsertWidgetSession({
      widgetSessionId: widgetSession.id,
      title: widgetSession.title,
      serverId: server.id,
      connectionId: connection.id,
      remoteWorkspaceId: workspace.id,
      remoteWorkspacePath: workspace.path,
      status: connection.status,
      authState: server.authState,
      lastHeartbeatAt: connection.lastHeartbeatAt,
      lastError: null,
    });
    await this.saveState();
    this.emitSnapshot(widgetSession.id);
    return {
      widgetSession: toPublicWidgetSession(this.resolveWidgetSession(widgetSession.id)),
      connection: toPublicConnection(connection),
    };
  }

  async refreshConnection(connectionId: string) {
    await this.hydrate();
    const current = this.resolveConnection(connectionId);
    if (!current) return null;
    try {
      const { session } = await this.broker.getSession(current.brokerSessionId);
      const next = widgetCodexConnectionRecordSchema.parse({
        ...current,
        frameUrl: session.frameUrl,
        proxyBaseUrl: session.proxyBaseUrl,
        status: session.status === 'ready' ? 'ready' : 'connecting',
        lastHeartbeatAt: session.lastHeartbeatAt ?? current.lastHeartbeatAt,
        lastError: null,
        updatedAt: nowIso(),
      });
      this.state = widgetCodexStateSchema.parse({
        ...this.state,
        connections: this.state.connections.map((entry) => (entry.id === connectionId ? next : entry)),
      });
      this.upsertWidgetSession({
        widgetSessionId: next.widgetSessionId,
        serverId: next.serverId,
        connectionId: next.id,
        remoteWorkspaceId: next.remoteWorkspaceId,
        remoteWorkspacePath: next.remoteWorkspacePath,
        status: next.status,
        authState: next.authState,
        lastHeartbeatAt: next.lastHeartbeatAt,
        lastError: null,
      });
      await this.saveState();
      this.emitSnapshot(next.widgetSessionId);
      return toPublicConnection(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection refresh failed.';
      const next = widgetCodexConnectionRecordSchema.parse({
        ...current,
        status: 'error',
        lastError: message,
        updatedAt: nowIso(),
      });
      this.state = widgetCodexStateSchema.parse({
        ...this.state,
        connections: this.state.connections.map((entry) => (entry.id === connectionId ? next : entry)),
      });
      this.upsertWidgetSession({
        widgetSessionId: next.widgetSessionId,
        serverId: next.serverId,
        connectionId: next.id,
        remoteWorkspaceId: next.remoteWorkspaceId,
        remoteWorkspacePath: next.remoteWorkspacePath,
        status: 'error',
        authState: next.authState,
        lastHeartbeatAt: next.lastHeartbeatAt,
        lastError: message,
      });
      await this.saveState();
      this.emitSnapshot(next.widgetSessionId);
      return toPublicConnection(next);
    }
  }

  async deleteConnection(connectionId: string) {
    await this.hydrate();
    const current = this.resolveConnection(connectionId);
    if (!current) return false;
    try {
      await this.broker.deleteSession(current.brokerSessionId);
    } catch {
      /* treat missing broker session as already closed */
    }
    this.state = widgetCodexStateSchema.parse({
      ...this.state,
      connections: this.state.connections.filter((entry) => entry.id !== connectionId),
    });
    this.upsertWidgetSession({
      widgetSessionId: current.widgetSessionId,
      serverId: current.serverId,
      connectionId: null,
      remoteWorkspaceId: current.remoteWorkspaceId,
      remoteWorkspacePath: current.remoteWorkspacePath,
      status: 'disconnected',
      authState: current.authState,
      lastHeartbeatAt: current.lastHeartbeatAt,
      lastError: null,
    });
    await this.saveState();
    this.emitSnapshot(current.widgetSessionId);
    return true;
  }

  async close() {
    this.events.removeAllListeners();
  }
}

export function createWidgetCodexServiceFromEnv() {
  const defaultServersRaw = process.env.WIDGET_CODEX_DEFAULT_SERVERS?.trim();
  const defaultServers = defaultServersRaw
    ? z.array(widgetCodexDefaultServerSchema).parse(JSON.parse(defaultServersRaw))
    : [];
  return new WidgetCodexService({
    stateFilePath: process.env.WIDGET_CODEX_STATE_FILE ?? null,
    realtimeUrl: process.env.WIDGET_CODEX_PUBLIC_WS_URL ?? null,
    defaultServers,
  });
}

export {
  widgetCodexCreateConnectionInputSchema,
  widgetCodexServerInputSchema,
  widgetCodexServerPatchSchema,
};
