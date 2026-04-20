import crypto from 'node:crypto';
import { z } from 'zod';
import {
  CodexBrokerSessionStore,
  type CodexBrokerSessionRecord,
  type CodexBrokerSessionSnapshot,
} from './session-store';
import { createCodexBrokerSshTunnel, type CodexBrokerSshTunnelConfig } from './ssh-tunnel';

export const createCodexBrokerSessionInputSchema = z.object({
  workspaceSessionId: z.string().min(1),
  remoteWorkingDirectory: z.string().min(1),
  reconnect: z.boolean().optional(),
});

export type CreateCodexBrokerSessionInput = z.infer<typeof createCodexBrokerSessionInputSchema>;

export type CodexBrokerServiceConfig = {
  idleTtlMs?: number;
  publicBaseUrl?: string | null;
  directTargetUrl?: string | null;
  ssh?: CodexBrokerSshTunnelConfig | null;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const buildPublicUrls = (sessionId: string, publicBaseUrl: string, proxyAccessToken: string) => {
  const base = normalizeBaseUrl(publicBaseUrl);
  return {
    proxyBaseUrl: `${base}/sessions/${encodeURIComponent(sessionId)}/proxy/${encodeURIComponent(proxyAccessToken)}`,
    frameUrl: `${base}/sessions/${encodeURIComponent(sessionId)}/proxy/${encodeURIComponent(proxyAccessToken)}/`,
  };
};

const normalizeTargetBaseUrl = (value: string) => {
  const url = new URL(value);
  if (!url.pathname) {
    url.pathname = '/';
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
};

export class CodexBrokerService {
  private readonly sessions = new CodexBrokerSessionStore();

  private readonly sessionCreateLocks = new Map<string, Promise<CodexBrokerSessionSnapshot>>();

  private readonly idleTtlMs: number;

  private readonly publicBaseUrl: string | null;

  private readonly directTargetUrl: string | null;

  private readonly sshConfig: CodexBrokerSshTunnelConfig | null;

  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(config: CodexBrokerServiceConfig = {}) {
    this.idleTtlMs = config.idleTtlMs ?? 15 * 60_000;
    this.publicBaseUrl = config.publicBaseUrl ? normalizeBaseUrl(config.publicBaseUrl) : null;
    this.directTargetUrl = config.directTargetUrl ? normalizeTargetBaseUrl(config.directTargetUrl) : null;
    this.sshConfig = config.ssh ?? null;
    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpiredSessions();
    }, 60_000);
    this.cleanupInterval.unref?.();
  }

  private createSessionId() {
    return `cxs_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  private createProxyAccessToken() {
    return crypto.randomBytes(24).toString('base64url');
  }

  private async withWorkspaceCreateLock(
    workspaceSessionId: string,
    factory: () => Promise<CodexBrokerSessionSnapshot>,
  ): Promise<CodexBrokerSessionSnapshot> {
    const existingLock = this.sessionCreateLocks.get(workspaceSessionId);
    if (existingLock) {
      return existingLock;
    }

    const lock = factory().finally(() => {
      if (this.sessionCreateLocks.get(workspaceSessionId) === lock) {
        this.sessionCreateLocks.delete(workspaceSessionId);
      }
    });
    this.sessionCreateLocks.set(workspaceSessionId, lock);
    return lock;
  }

  private async createTargetBaseUrl() {
    if (this.directTargetUrl) {
      return {
        targetBaseUrl: this.directTargetUrl,
        close: async () => {},
      };
    }
    if (!this.sshConfig) {
      throw new Error(
        'Codex broker is not configured. Set CODEX_BROKER_DIRECT_TARGET_URL or the CODEX_BROKER_SSH_* variables.',
      );
    }
    return createCodexBrokerSshTunnel(this.sshConfig);
  }

  private toSnapshot(record: CodexBrokerSessionRecord, publicBaseUrl?: string | null): CodexBrokerSessionSnapshot {
    const baseUrl = publicBaseUrl ? normalizeBaseUrl(publicBaseUrl) : this.publicBaseUrl;
    if (!baseUrl) {
      throw new Error('Codex broker publicBaseUrl is required to build browser-accessible proxy URLs.');
    }
    const { proxyBaseUrl, frameUrl } = buildPublicUrls(record.sessionId, baseUrl, record.proxyAccessToken);
    return {
      sessionId: record.sessionId,
      workspaceSessionId: record.workspaceSessionId,
      remoteWorkingDirectory: record.remoteWorkingDirectory,
      proxyBaseUrl,
      frameUrl,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastHeartbeatAt: record.lastHeartbeatAt,
    };
  }

  async createSession(
    input: CreateCodexBrokerSessionInput,
    options: { publicBaseUrl?: string | null } = {},
  ): Promise<CodexBrokerSessionSnapshot> {
    return this.withWorkspaceCreateLock(input.workspaceSessionId, async () => {
      const reconnect = input.reconnect ?? true;
      const existing = reconnect ? this.sessions.findByWorkspaceSessionId(input.workspaceSessionId) : null;

      if (existing && existing.remoteWorkingDirectory === input.remoteWorkingDirectory && existing.status === 'ready') {
        const touched = this.sessions.touch(existing.sessionId) ?? existing;
        return this.toSnapshot(touched, options.publicBaseUrl);
      }

      if (existing) {
        await this.deleteSession(existing.sessionId);
      }

      const now = new Date().toISOString();
      const target = await this.createTargetBaseUrl();
      const record: CodexBrokerSessionRecord = {
        sessionId: this.createSessionId(),
        workspaceSessionId: input.workspaceSessionId,
        remoteWorkingDirectory: input.remoteWorkingDirectory,
        targetBaseUrl: target.targetBaseUrl,
        proxyAccessToken: this.createProxyAccessToken(),
        status: 'ready',
        createdAt: now,
        updatedAt: now,
        lastHeartbeatAt: now,
        close: target.close,
      };
      this.sessions.set(record);
      return this.toSnapshot(record, options.publicBaseUrl);
    });
  }

  getSession(sessionId: string, options: { publicBaseUrl?: string | null } = {}) {
    const record = this.sessions.get(sessionId);
    if (!record) return null;
    return this.toSnapshot(record, options.publicBaseUrl);
  }

  touchSession(sessionId: string, options: { publicBaseUrl?: string | null } = {}) {
    const record = this.sessions.touch(sessionId);
    if (!record) return null;
    return this.toSnapshot(record, options.publicBaseUrl);
  }

  getSessionRecord(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  async deleteSession(sessionId: string) {
    const record = this.sessions.delete(sessionId);
    if (!record) return false;
    try {
      await record.close();
    } finally {
      record.status = 'closed';
    }
    return true;
  }

  async cleanupExpiredSessions() {
    const cutoff = Date.now() - this.idleTtlMs;
    await Promise.all(
      this.sessions.list().map(async (session) => {
        const lastHeartbeat = Date.parse(session.lastHeartbeatAt);
        if (!Number.isFinite(lastHeartbeat) || lastHeartbeat >= cutoff) return;
        await this.deleteSession(session.sessionId);
      }),
    );
  }

  async close() {
    clearInterval(this.cleanupInterval);
    await Promise.all(this.sessions.list().map((session) => this.deleteSession(session.sessionId)));
  }
}

export function createCodexBrokerServiceFromEnv() {
  const directTargetUrl = process.env.CODEX_BROKER_DIRECT_TARGET_URL ?? null;
  const sshHost = process.env.CODEX_BROKER_SSH_HOST ?? null;
  const sshUsername = process.env.CODEX_BROKER_SSH_USERNAME ?? null;
  const remoteHost = process.env.CODEX_BROKER_REMOTE_HOST ?? '127.0.0.1';
  const remotePort = Number(process.env.CODEX_BROKER_REMOTE_PORT ?? '4500');

  return new CodexBrokerService({
    idleTtlMs: Number(process.env.CODEX_BROKER_IDLE_TTL_MS ?? String(15 * 60_000)),
    publicBaseUrl: process.env.CODEX_BROKER_PUBLIC_BASE_URL ?? null,
    directTargetUrl,
    ssh:
      directTargetUrl || !sshHost || !sshUsername
        ? null
        : {
            host: sshHost,
            port: Number(process.env.CODEX_BROKER_SSH_PORT ?? '22'),
            username: sshUsername,
            remoteHost,
            remotePort,
            remoteProtocol: process.env.CODEX_BROKER_REMOTE_PROTOCOL === 'https' ? 'https' : 'http',
            hostKeySha256: process.env.CODEX_BROKER_SSH_HOST_KEY_SHA256 ?? null,
            privateKeyPath: process.env.CODEX_BROKER_SSH_PRIVATE_KEY_PATH ?? null,
            privateKey: process.env.CODEX_BROKER_SSH_PRIVATE_KEY ?? null,
            passphrase: process.env.CODEX_BROKER_SSH_PASSPHRASE ?? null,
            agentSocketPath: process.env.SSH_AUTH_SOCK ?? null,
          },
  });
}
