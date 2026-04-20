export type CodexBrokerSessionStatus = 'ready' | 'closed' | 'error';

export type CodexBrokerSessionSnapshot = {
  sessionId: string;
  workspaceSessionId: string;
  remoteWorkingDirectory: string;
  proxyBaseUrl: string;
  frameUrl: string;
  status: CodexBrokerSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt: string;
};

export type CodexBrokerSessionRecord = {
  sessionId: string;
  workspaceSessionId: string;
  remoteWorkingDirectory: string;
  targetBaseUrl: string;
  proxyAccessToken: string;
  status: CodexBrokerSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt: string;
  close: () => Promise<void>;
};

export class CodexBrokerSessionStore {
  private readonly sessions = new Map<string, CodexBrokerSessionRecord>();

  get(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  list() {
    return [...this.sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  findByWorkspaceSessionId(workspaceSessionId: string) {
    return this.list().find((session) => session.workspaceSessionId === workspaceSessionId) ?? null;
  }

  set(record: CodexBrokerSessionRecord) {
    this.sessions.set(record.sessionId, record);
    return record;
  }

  delete(sessionId: string) {
    const record = this.sessions.get(sessionId) ?? null;
    if (record) {
      this.sessions.delete(sessionId);
    }
    return record;
  }

  touch(sessionId: string) {
    const current = this.get(sessionId);
    if (!current) return null;
    const now = new Date().toISOString();
    const next: CodexBrokerSessionRecord = {
      ...current,
      updatedAt: now,
      lastHeartbeatAt: now,
    };
    this.sessions.set(sessionId, next);
    return next;
  }
}
