'use client';

import { CodexRemoteFrame } from './codex-remote-frame';

export type CodexRemoteSessionState = {
  sessionId: string;
  status: string;
  frameUrl: string;
  proxyBaseUrl: string;
  executorSessionId: string | null;
  remoteWorkingDirectory: string;
  lastHeartbeatAt: string | null;
};

type CodexRemoteWidgetProps = {
  session: CodexRemoteSessionState | null;
  remoteWorkspacePath: string;
  isBusy?: boolean;
  onRemoteWorkspacePathChange: (nextValue: string) => void;
  onConnect: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
};

export function CodexRemoteWidget({
  session,
  remoteWorkspacePath,
  isBusy = false,
  onRemoteWorkspacePathChange,
  onConnect,
  onReconnect,
  onDisconnect,
}: CodexRemoteWidgetProps) {
  const hasSession = !!session?.frameUrl;

  return (
    <div className="reset-frame-shell">
      <label className="reset-field-label">Remote Workspace Path</label>
      <input
        className="reset-input"
        value={remoteWorkspacePath}
        onChange={(event) => onRemoteWorkspacePathChange(event.target.value)}
        placeholder="/srv/codex/repos/PRESENT"
      />
      <div className="reset-inline-actions">
        <button
          type="button"
          onClick={hasSession ? onReconnect : onConnect}
          className="reset-button"
          disabled={isBusy || !remoteWorkspacePath.trim()}
        >
          {hasSession ? 'Reconnect Remote Codex' : 'Connect Remote Codex'}
        </button>
        {session?.frameUrl ? (
          <a href={session.frameUrl} target="_blank" rel="noreferrer" className="reset-button reset-button--ghost">
            Pop Out
          </a>
        ) : null}
        {hasSession ? (
          <button type="button" onClick={onDisconnect} className="reset-button reset-button--secondary" disabled={isBusy}>
            Disconnect
          </button>
        ) : null}
      </div>
      {session ? (
        <div className="reset-meta-grid">
          <div>
            <span>Status</span>
            <strong>{session.status}</strong>
          </div>
          <div>
            <span>Executor</span>
            <strong>{session.executorSessionId ?? 'pending'}</strong>
          </div>
          <div>
            <span>Session</span>
            <strong>{session.sessionId}</strong>
          </div>
          <div>
            <span>Heartbeat</span>
            <strong>{session.lastHeartbeatAt ?? 'pending'}</strong>
          </div>
        </div>
      ) : null}
      {session?.frameUrl ? (
        <CodexRemoteFrame
          title="Remote Codex"
          subtitle={session.remoteWorkingDirectory}
          frameUrl={session.frameUrl}
          toolbar={
            <p className="reset-list-card__path">
              Browser traffic stays on the PRESENT broker; Codex commands run against the remote workspace.
            </p>
          }
        />
      ) : (
        <div className="reset-empty">No active remote Codex session.</div>
      )}
    </div>
  );
}
