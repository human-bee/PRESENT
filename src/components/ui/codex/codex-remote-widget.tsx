'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodexRemoteFrame } from '@present/ui/codex-remote-frame';
import { Button } from '@/components/ui/shared/button';
import { ComponentRegistry } from '@/lib/component-registry';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import { codexRemoteWidgetSchema, type CodexRemoteWidgetProps } from './codex-remote-widget-schema';

export { codexRemoteWidgetSchema };

type CodexRemoteWidgetState = {
  title?: string;
  subtitle?: string;
  frameUrl?: string;
  className?: string;
  contextKey?: string;
};

type PersistedWidgetState = {
  title?: string;
  subtitle?: string;
  frameUrl?: string;
};

type CanvasCodexRemoteWidgetProps = CodexRemoteWidgetProps & {
  state?: PersistedWidgetState;
  updateState?: (patch: PersistedWidgetState | ((prev: PersistedWidgetState) => PersistedWidgetState)) => void;
};

const LOCAL_STORAGE_KEY = 'present.codexRemoteWidget.lastConfig';
const stopPointerPropagation: React.PointerEventHandler<HTMLElement> = (event) => {
  event.stopPropagation();
};

function createFallbackId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `codex-remote-${crypto.randomUUID()}`;
  }
  return `codex-remote-${Date.now().toString(36)}`;
}

function readStoredConfig(): PersistedWidgetState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWidgetState;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
      frameUrl: typeof parsed.frameUrl === 'string' ? parsed.frameUrl : undefined,
    };
  } catch {
    return null;
  }
}

function writeStoredConfig(state: PersistedWidgetState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function CodexRemoteWidget(props: CanvasCodexRemoteWidgetProps) {
  const { __custom_message_id, messageId: propMessageId, contextKey, className, ...rest } = props;
  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = createFallbackId();
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;
  const persistedState = props.state;

  const [state, setState] = useState<CodexRemoteWidgetState>(() => ({
    title: persistedState?.title ?? rest.title,
    subtitle: persistedState?.subtitle ?? rest.subtitle,
    frameUrl: persistedState?.frameUrl ?? rest.frameUrl,
    className,
    contextKey,
  }));
  const [draftTitle, setDraftTitle] = useState(() => persistedState?.title ?? rest.title ?? 'Remote Codex');
  const [draftSubtitle, setDraftSubtitle] = useState(() => persistedState?.subtitle ?? rest.subtitle ?? '');
  const [draftFrameUrl, setDraftFrameUrl] = useState(() => persistedState?.frameUrl ?? rest.frameUrl ?? '');
  const [isEditing, setIsEditing] = useState(() => !(persistedState?.frameUrl ?? rest.frameUrl));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextTitle = persistedState?.title ?? rest.title ?? 'Remote Codex';
    const nextSubtitle = persistedState?.subtitle ?? rest.subtitle ?? '';
    const nextFrameUrl = persistedState?.frameUrl ?? rest.frameUrl ?? '';
    setState((previous) => ({
      ...previous,
      title: nextTitle,
      subtitle: nextSubtitle,
      frameUrl: nextFrameUrl,
    }));
    setDraftTitle(nextTitle);
    setDraftSubtitle(nextSubtitle);
    setDraftFrameUrl(nextFrameUrl);
    if (!nextFrameUrl) {
      const stored = readStoredConfig();
      if (stored?.frameUrl) {
        setDraftTitle(stored.title || nextTitle);
        setDraftSubtitle(stored.subtitle || nextSubtitle);
        setDraftFrameUrl(stored.frameUrl);
      }
    }
  }, [persistedState?.frameUrl, persistedState?.subtitle, persistedState?.title, rest.frameUrl, rest.subtitle, rest.title]);

  const registryProps = useMemo(
    () => ({
      title: state.title,
      subtitle: state.subtitle,
      frameUrl: state.frameUrl,
      className,
      contextKey,
    }),
    [className, contextKey, state.frameUrl, state.subtitle, state.title],
  );

  useComponentRegistration(messageId, 'CodexRemoteWidget', registryProps, contextKey || 'canvas', (patch) => {
    setState((previous) => {
      const next = {
        ...previous,
        title: typeof patch.title === 'string' ? patch.title : previous.title,
        subtitle: typeof patch.subtitle === 'string' ? patch.subtitle : previous.subtitle,
        frameUrl: typeof patch.frameUrl === 'string' ? patch.frameUrl : previous.frameUrl,
        className: typeof patch.className === 'string' ? patch.className : previous.className,
      };
      setDraftTitle(next.title || 'Remote Codex');
      setDraftSubtitle(next.subtitle || '');
      setDraftFrameUrl(next.frameUrl || '');
      return next;
    });
  });

  const persistDraft = useCallback(async () => {
    const nextFrameUrl = draftFrameUrl.trim();
    if (!nextFrameUrl) {
      setError('Enter a brokered frame URL to load Remote Codex.');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(nextFrameUrl);
    } catch {
      setError('Frame URL must be a valid absolute URL.');
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      setError('Frame URL must use http or https.');
      return;
    }

    const nextState = {
      title: draftTitle.trim() || 'Remote Codex',
      subtitle: draftSubtitle.trim(),
      frameUrl: nextFrameUrl,
    };
    setError(null);
    setState((previous) => ({ ...previous, ...nextState }));
    props.updateState?.(nextState);
    writeStoredConfig(nextState);
    await ComponentRegistry.update(messageId, nextState);
    setIsEditing(false);
  }, [draftFrameUrl, draftSubtitle, draftTitle, messageId, props]);

  const clearDraft = useCallback(async () => {
    const nextState = {
      title: draftTitle.trim() || 'Remote Codex',
      subtitle: draftSubtitle.trim(),
      frameUrl: '',
    };
    setState((previous) => ({ ...previous, ...nextState }));
    props.updateState?.(nextState);
    setDraftFrameUrl('');
    setError(null);
    await ComponentRegistry.update(messageId, nextState);
    setIsEditing(true);
  }, [draftSubtitle, draftTitle, messageId, props]);

  const openResetShell = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.location.assign('/');
  }, []);

  const openFrameUrl = useCallback(() => {
    if (typeof window === 'undefined' || !state.frameUrl) return;
    const opened = window.open(state.frameUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(state.frameUrl);
    }
  }, [state.frameUrl]);

  return (
    <div className={cn('flex h-full w-full flex-col gap-3 rounded-[24px] border border-[var(--color-divider)] bg-[var(--color-panel)] p-3', state.className)}>
      {state.frameUrl && !isEditing ? (
        <CodexRemoteFrame
          title={state.title || 'Remote Codex'}
          subtitle={state.subtitle || 'Brokered remote Codex surface'}
          frameUrl={state.frameUrl}
          toolbar={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => setIsEditing(true)}>
                Edit
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
            <p className="text-sm font-semibold text-primary">Remote Codex Setup</p>
            <p className="mt-1 text-xs text-secondary">
              Paste a brokered Remote Codex frame URL. This hotfix makes toolbar-created widgets configurable directly on canvas.
            </p>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Title</span>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              placeholder="Remote Codex"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Subtitle / Workspace Path</span>
            <input
              value={draftSubtitle}
              onChange={(event) => setDraftSubtitle(event.target.value)}
              className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              placeholder="/srv/codex/repos/PRESENT"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Broker Frame URL</span>
            <input
              value={draftFrameUrl}
              onChange={(event) => setDraftFrameUrl(event.target.value)}
              className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              placeholder="https://broker.example/sessions/cxs_123/proxy/token/"
            />
          </label>
          {error ? (
            <div className="rounded-lg border border-danger-outline bg-danger-surface px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onPointerDown={stopPointerPropagation} onClick={() => void persistDraft()}>
              {state.frameUrl ? 'Update Widget' : 'Load Remote Codex'}
            </Button>
            {state.frameUrl ? (
              <Button size="sm" variant="outline" onPointerDown={stopPointerPropagation} onClick={() => void clearDraft()}>
                Clear URL
              </Button>
            ) : null}
            <button
              type="button"
              onPointerDown={stopPointerPropagation}
              onClick={openResetShell}
              className="text-xs text-[var(--present-accent)] underline underline-offset-2"
            >
              Open Reset Shell
            </button>
          </div>
          {!state.frameUrl ? (
            <div className="text-xs text-secondary">No remote Codex frame URL configured.</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CodexRemoteWidget;
