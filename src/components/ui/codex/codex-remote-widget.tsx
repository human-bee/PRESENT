'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodexRemoteFrame } from '@present/ui/codex-remote-frame';
import { Button } from '@/components/ui/shared/button';
import { ComponentRegistry, useComponentRegistration } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { codexRemoteWidgetSchema, type CodexRemoteWidgetProps } from './codex-remote-widget-schema';

export { codexRemoteWidgetSchema };

type PersistedWidgetState = {
  title?: string;
  subtitle?: string;
  frameUrl?: string;
  sessionId?: string;
  workspaceSessionId?: string;
  executorSessionId?: string;
  proxyBaseUrl?: string;
  remoteWorkingDirectory?: string;
  status?: string;
  lastHeartbeatAt?: string;
};

type CanvasCodexRemoteWidgetProps = CodexRemoteWidgetProps & {
  state?: PersistedWidgetState;
  updateState?: (patch: PersistedWidgetState | ((prev: PersistedWidgetState) => PersistedWidgetState)) => void;
};

type CodexRemoteSessionResponse = {
  sessionId: string;
  workspaceSessionId?: string;
  executorSessionId?: string;
  status: string;
  frameUrl: string;
  proxyBaseUrl: string;
  remoteWorkingDirectory: string;
  lastHeartbeatAt?: string;
};

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

function buildInitialState(
  persistedState: PersistedWidgetState | undefined,
  rest: CodexRemoteWidgetProps,
) {
  return {
    title: persistedState?.title ?? rest.title ?? 'Remote Codex',
    subtitle: persistedState?.subtitle ?? rest.subtitle ?? '',
    frameUrl: persistedState?.frameUrl ?? rest.frameUrl,
    sessionId: persistedState?.sessionId,
    workspaceSessionId: persistedState?.workspaceSessionId,
    executorSessionId: persistedState?.executorSessionId,
    proxyBaseUrl: persistedState?.proxyBaseUrl,
    remoteWorkingDirectory: persistedState?.remoteWorkingDirectory ?? persistedState?.subtitle ?? rest.subtitle ?? '',
    status: persistedState?.status,
    lastHeartbeatAt: persistedState?.lastHeartbeatAt,
  } satisfies PersistedWidgetState;
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

function isNotFoundError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as HttpError).status === 404;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function CodexRemoteWidget(props: CanvasCodexRemoteWidgetProps) {
  const { __custom_message_id, messageId: propMessageId, contextKey, className, ...rest } = props;
  const fallbackIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = createFallbackId();
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;
  const persistedState = props.state;

  const [state, setState] = useState<PersistedWidgetState>(() => buildInitialState(persistedState, rest));
  const [draftTitle, setDraftTitle] = useState(() => persistedState?.title ?? rest.title ?? 'Remote Codex');
  const [draftRemoteWorkspacePath, setDraftRemoteWorkspacePath] = useState(
    () => persistedState?.remoteWorkingDirectory ?? persistedState?.subtitle ?? rest.subtitle ?? rest.frameUrl ?? '',
  );
  const [isEditing, setIsEditing] = useState(() => !(persistedState?.frameUrl ?? rest.frameUrl));
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const nextState = buildInitialState(persistedState, rest);
    setState(nextState);
    setDraftTitle(nextState.title ?? 'Remote Codex');
    setDraftRemoteWorkspacePath(nextState.remoteWorkingDirectory ?? nextState.subtitle ?? '');
    setIsEditing(!nextState.frameUrl);
  }, [
    persistedState?.executorSessionId,
    persistedState?.frameUrl,
    persistedState?.lastHeartbeatAt,
    persistedState?.proxyBaseUrl,
    persistedState?.remoteWorkingDirectory,
    persistedState?.sessionId,
    persistedState?.status,
    persistedState?.subtitle,
    persistedState?.title,
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
      setDraftRemoteWorkspacePath(next.remoteWorkingDirectory ?? next.subtitle ?? '');
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
        /* component may remount while async updates resolve */
      }
    },
    [messageId, props],
  );

  const applySession = useCallback(
    async (session: CodexRemoteSessionResponse, titleOverride?: string) => {
      const nextState: PersistedWidgetState = {
        title: titleOverride ?? (draftTitle.trim() || state.title || 'Remote Codex'),
        subtitle: session.remoteWorkingDirectory,
        frameUrl: session.frameUrl,
        sessionId: session.sessionId,
        workspaceSessionId: session.workspaceSessionId ?? state.workspaceSessionId,
        executorSessionId: session.executorSessionId,
        proxyBaseUrl: session.proxyBaseUrl,
        remoteWorkingDirectory: session.remoteWorkingDirectory,
        status: session.status,
        lastHeartbeatAt: session.lastHeartbeatAt,
      };
      await persistState(nextState);
      if (!mountedRef.current) return;
      setDraftTitle(nextState.title ?? 'Remote Codex');
      setDraftRemoteWorkspacePath(session.remoteWorkingDirectory);
      setIsEditing(false);
      setError(null);
    },
    [draftTitle, persistState, state.title, state.workspaceSessionId],
  );

  const clearSessionState = useCallback(
    async (message?: string) => {
      const nextState: PersistedWidgetState = {
        title: draftTitle.trim() || state.title || 'Remote Codex',
        subtitle: draftRemoteWorkspacePath.trim() || state.remoteWorkingDirectory || state.subtitle || '',
        frameUrl: undefined,
        sessionId: undefined,
        workspaceSessionId: state.workspaceSessionId,
        executorSessionId: undefined,
        proxyBaseUrl: undefined,
        remoteWorkingDirectory: draftRemoteWorkspacePath.trim() || state.remoteWorkingDirectory || '',
        status: 'disconnected',
        lastHeartbeatAt: undefined,
      };
      await persistState(nextState);
      if (!mountedRef.current) return;
      setIsEditing(true);
      setError(message ?? null);
    },
    [draftRemoteWorkspacePath, draftTitle, persistState, state.remoteWorkingDirectory, state.sessionId, state.subtitle, state.title, state.workspaceSessionId],
  );

  const refreshSession = useCallback(async () => {
    if (!state.sessionId) return;
    try {
      const session = await requestJson<CodexRemoteSessionResponse>(
        `/api/reset/codex/sessions/${encodeURIComponent(state.sessionId)}`,
      );
      await applySession(session, state.title);
    } catch (requestError) {
      if (!isNotFoundError(requestError)) {
        if (mountedRef.current) {
          setError(getErrorMessage(requestError, 'Failed to refresh Remote Codex session.'));
        }
        return;
      }
      await clearSessionState('Remote Codex session expired. Connect again.');
    }
  }, [applySession, clearSessionState, state.sessionId, state.title]);

  useEffect(() => {
    if (!state.sessionId) return;
    const interval = window.setInterval(() => {
      void refreshSession();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [refreshSession, state.sessionId]);

  const connectRemoteCodex = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const session = await requestJson<CodexRemoteSessionResponse>(
        '/api/reset/codex/sessions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceSessionId: state.workspaceSessionId,
            remoteWorkspacePath: draftRemoteWorkspacePath.trim() || undefined,
            reconnect: true,
          }),
        },
      );
      await applySession(session);
    } catch (requestError) {
      if (mountedRef.current) {
        setError(getErrorMessage(requestError, 'Failed to connect Remote Codex.'));
      }
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [applySession, draftRemoteWorkspacePath, state.workspaceSessionId]);

  const disconnectRemoteCodex = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      if (state.sessionId) {
        await requestJson<{ deleted: boolean }>(
          `/api/reset/codex/sessions/${encodeURIComponent(state.sessionId)}`,
          {
            method: 'DELETE',
          },
        );
      }
      await clearSessionState();
    } catch (requestError) {
      if (mountedRef.current) {
        setError(getErrorMessage(requestError, 'Failed to disconnect Remote Codex.'));
      }
    } finally {
      if (mountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [clearSessionState, state.sessionId]);

  const openFrameUrl = useCallback(() => {
    if (typeof window === 'undefined' || !state.frameUrl) return;
    const opened = window.open(state.frameUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(state.frameUrl);
    }
  }, [state.frameUrl]);

  const statusLabel =
    state.status === 'ready'
      ? 'Connected'
      : state.status === 'disconnected'
        ? 'Disconnected'
        : state.status
          ? state.status[0]?.toUpperCase() + state.status.slice(1)
          : 'Not connected';

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-3 rounded-[24px] border border-[var(--color-divider)] bg-[var(--color-panel)] p-3',
        className,
      )}
    >
      {state.frameUrl && !isEditing ? (
        <CodexRemoteFrame
          title={state.title || 'Remote Codex'}
          subtitle={state.remoteWorkingDirectory || state.subtitle || 'Brokered remote Codex surface'}
          frameUrl={state.frameUrl}
          toolbar={
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-default bg-surface px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-secondary">
                {statusLabel}
              </div>
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void refreshSession()}>
                Reconnect
              </Button>
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => setIsEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void disconnectRemoteCodex()}>
                Disconnect
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
          }
        />
      ) : (
        <div className="flex h-full flex-col gap-3 rounded-[20px] border border-dashed border-[var(--color-divider)] bg-[var(--color-muted)]/30 p-4">
          <div>
            <p className="text-sm font-semibold text-primary">Remote Codex</p>
            <p className="mt-1 text-xs text-secondary">
              Connect this widget directly to the brokered Remote Codex session. No manual frame URL copy-paste.
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
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Remote Workspace Path</span>
            <input
              value={draftRemoteWorkspacePath}
              onPointerDown={stopPointerPropagation}
              onChange={(event) => setDraftRemoteWorkspacePath(event.target.value)}
              className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              placeholder="/srv/codex/repos/PRESENT"
            />
          </label>
          <div className="rounded-lg border border-default bg-surface px-3 py-2 text-xs text-secondary">
            <div>Status: {statusLabel}</div>
            {state.lastHeartbeatAt ? <div>Last heartbeat: {new Date(state.lastHeartbeatAt).toLocaleString()}</div> : null}
            {state.sessionId ? <div>Session: {state.sessionId}</div> : null}
          </div>
          {error ? (
            <div className="rounded-lg border border-danger-outline bg-danger-surface px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onPointerDown={stopPointerPropagation} onClick={() => void connectRemoteCodex()} disabled={isBusy}>
              {isBusy ? 'Connecting...' : state.sessionId ? 'Reconnect Remote Codex' : 'Connect Remote Codex'}
            </Button>
            {state.sessionId || state.frameUrl ? (
              <Button
                size="sm"
                variant="outline"
                onPointerDown={stopPointerPropagation}
                onClick={() => void disconnectRemoteCodex()}
                disabled={isBusy}
              >
                Disconnect
              </Button>
            ) : null}
            {state.frameUrl ? (
              <button
                type="button"
                onPointerDown={stopPointerPropagation}
                onClick={openFrameUrl}
                className="text-xs text-[var(--present-accent)] underline underline-offset-2"
              >
                Pop Out
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default CodexRemoteWidget;
