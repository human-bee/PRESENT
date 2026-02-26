"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport, buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiDisplayMode, McpUiHostContext, McpUiTheme } from '@modelcontextprotocol/ext-apps';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import { waitForMcpReady } from '@/lib/mcp-bridge';
import { resolveMcpServer, getMcpServerUrl } from '@/lib/mcp-apps/server-utils';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import {
  loadMcpAppResource,
  resolveToolResourceUri,
  callMcpMethod,
} from '@/lib/mcp-apps/resource-loader';
import { type McpAppToolDescriptor } from '@/lib/mcp-apps/types';
import { mcpAppWidgetSchema, type McpAppWidgetProps } from './mcp-app-widget-schema';

export { mcpAppWidgetSchema };

type McpAppWidgetState = {
  title?: string;
  toolName?: string;
  serverUrl?: string;
  serverName?: string;
  resourceUri?: string;
  args?: Record<string, unknown>;
  syncRoom?: string;
  syncComponentId?: string;
  syncIntervalMs?: number;
  syncTimeline?: boolean;
  autoRun?: boolean;
  runId?: string;
  displayMode?: string;
  className?: string;
  contextKey?: string;
};

type ScorecardSyncSnapshot = {
  room: string;
  componentId: string;
  timeline: Array<Record<string, unknown>>;
  topic?: string;
  round?: string;
  status?: Record<string, unknown>;
  version?: number;
  lastUpdated?: number;
  syncedAt: number;
};

const HOST_INFO = { name: 'PRESENT', version: '0.1.0' };
const DEFAULT_DISPLAY_MODES: McpUiDisplayMode[] = ['inline', 'pip', 'fullscreen'];
const DEFAULT_SCORECARD_SYNC_INTERVAL_MS = 3000;

const coerceText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const coerceFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const coerceDisplayMode = (value: unknown): McpUiDisplayMode => {
  if (value === 'fullscreen' || value === 'pip' || value === 'inline') return value;
  // Legacy values used by older code paths.
  if (value === 'modal') return 'fullscreen';
  if (value === 'panel') return 'pip';
  return 'inline';
};

const coerceBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

const stringifyArgs = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '';
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const buildTimelineFingerprint = (timeline: Array<Record<string, unknown>>): string => {
  const last = timeline.length > 0 ? timeline[timeline.length - 1] : undefined;
  const lastId = last ? coerceText(last.id ?? last.eventId) ?? 'na' : 'na';
  const lastTimestamp = last ? coerceFiniteNumber(last.timestamp ?? last.ts) ?? -1 : -1;
  return `${timeline.length}:${lastId}:${lastTimestamp}`;
};

const normalizeToolResult = (result: unknown, isError = false) => {
  if (result && typeof result === 'object' && 'content' in (result as any)) {
    return result as any;
  }
  const text =
    typeof result === 'string'
      ? result
      : (() => {
          try {
            return JSON.stringify(result, null, 2);
          } catch {
            return String(result);
          }
        })();
  return {
    content: [{ type: 'text', text: text || '' }],
    isError,
  };
};

const extractTextFromContent = (content?: Array<{ type?: string; text?: string }>) => {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
    .filter((text) => text)
    .join('\n');
};

const injectCspMeta = (html: string, csp?: string) => {
  if (!csp) return html;
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const headIndex = html.indexOf('<head');
  if (headIndex >= 0) {
    const closeIndex = html.indexOf('>', headIndex);
    if (closeIndex >= 0) {
      return `${html.slice(0, closeIndex + 1)}${metaTag}${html.slice(closeIndex + 1)}`;
    }
  }
  return `${metaTag}${html}`;
};

export function McpAppWidget(props: McpAppWidgetProps) {
  const {
    __custom_message_id,
    messageId: propMessageId,
    contextKey,
    className,
    ...rest
  } = props;

  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `mcp-app-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const [state, setState] = useState<McpAppWidgetState>(() => ({
    title: rest.title,
    toolName: rest.toolName,
    serverUrl: rest.serverUrl,
    serverName: rest.serverName,
    resourceUri: rest.resourceUri,
    args: rest.args,
    syncRoom: rest.syncRoom,
    syncComponentId: rest.syncComponentId,
    syncIntervalMs: rest.syncIntervalMs,
    syncTimeline: rest.syncTimeline,
    autoRun: rest.autoRun,
    runId: rest.runId,
    displayMode: rest.displayMode,
    className,
    contextKey,
  }));

  const [toolDescriptor, setToolDescriptor] = useState<McpAppToolDescriptor | undefined>();
  const [resourceHtml, setResourceHtml] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const lastRunKeyRef = useRef<string>('');
  const latestScorecardSnapshotRef = useRef<ScorecardSyncSnapshot | null>(null);
  const lastScorecardSyncSignatureRef = useRef<string>('');

  const registryProps = useMemo(
    () => ({
      title: state.title,
      toolName: state.toolName,
      serverUrl: state.serverUrl,
      serverName: state.serverName,
      resourceUri: state.resourceUri,
      args: state.args,
      syncRoom: state.syncRoom,
      syncComponentId: state.syncComponentId,
      syncIntervalMs: state.syncIntervalMs,
      syncTimeline: state.syncTimeline,
      autoRun: state.autoRun,
      runId: state.runId,
      displayMode: state.displayMode,
      className,
    }),
    [className, state],
  );

  const applyPatch = useCallback((patch: Record<string, unknown>) => {
    setState((prev) => ({
      ...prev,
      title: typeof patch.title === 'string' ? patch.title : prev.title,
      toolName: typeof patch.toolName === 'string' ? patch.toolName : prev.toolName,
      serverUrl: typeof patch.serverUrl === 'string' ? patch.serverUrl : prev.serverUrl,
      serverName: typeof patch.serverName === 'string' ? patch.serverName : prev.serverName,
      resourceUri: typeof patch.resourceUri === 'string' ? patch.resourceUri : prev.resourceUri,
      args: typeof patch.args === 'object' && patch.args ? (patch.args as Record<string, unknown>) : prev.args,
      syncRoom: typeof patch.syncRoom === 'string' ? patch.syncRoom : prev.syncRoom,
      syncComponentId:
        typeof patch.syncComponentId === 'string' ? patch.syncComponentId : prev.syncComponentId,
      syncIntervalMs:
        typeof patch.syncIntervalMs === 'number' && Number.isFinite(patch.syncIntervalMs)
          ? patch.syncIntervalMs
          : prev.syncIntervalMs,
      syncTimeline:
        typeof patch.syncTimeline === 'boolean' ? patch.syncTimeline : prev.syncTimeline,
      autoRun: typeof patch.autoRun === 'boolean' ? patch.autoRun : prev.autoRun,
      runId: typeof patch.runId === 'string' ? patch.runId : prev.runId,
      displayMode: typeof patch.displayMode === 'string' ? patch.displayMode : prev.displayMode,
    }));
  }, []);

  useComponentRegistration(messageId, 'McpAppWidget', registryProps, contextKey || 'canvas', applyPatch);

  useEffect(() => {
    let mounted = true;
    waitForMcpReady(400).then(() => {
      if (!mounted) return;
      const registry = (window as any).__custom_mcp_tools || {};
      const name = state.toolName?.trim();
      if (!name) {
        setToolDescriptor(undefined);
        return;
      }
      const entry = registry[name] || registry[`mcp_${name}`];
      setToolDescriptor(entry);
    });
    return () => {
      mounted = false;
    };
  }, [state.toolName]);

  const resolvedServer = useMemo(() => {
    if (state.serverUrl) {
      return { url: state.serverUrl };
    }
    return resolveMcpServer(state.serverName);
  }, [state.serverName, state.serverUrl]);

  const serverUrl = useMemo(() => {
    if (state.serverUrl) return state.serverUrl;
    return getMcpServerUrl(resolvedServer.server);
  }, [resolvedServer.server, state.serverUrl]);

  const resolvedResourceUri = useMemo(() => {
    if (state.resourceUri) return state.resourceUri;
    return resolveToolResourceUri(toolDescriptor);
  }, [state.resourceUri, toolDescriptor]);

  const uiMeta = useMemo(() => {
    const meta = toolDescriptor?._meta ?? {};
    const nested = (meta as any)?.ui;
    return {
      permissions: (nested as any)?.permissions ?? (meta as any)?.['ui/permissions'],
      csp: (nested as any)?.csp ?? (meta as any)?.['ui/csp'],
    };
  }, [toolDescriptor]);

  const argsSyncRoom = coerceText(state.args?.room);
  const argsSyncComponentId =
    coerceText(state.args?.componentId) ?? coerceText(state.args?.scorecardComponentId);
  const scorecardSync = useMemo(() => {
    const room = coerceText(state.syncRoom) ?? argsSyncRoom;
    const componentId = coerceText(state.syncComponentId) ?? argsSyncComponentId;
    const enabled = coerceBoolean(state.syncTimeline, false);
    const intervalMs = Math.max(
      1000,
      Math.min(
        30_000,
        Math.round(
          coerceFiniteNumber(state.syncIntervalMs) ?? DEFAULT_SCORECARD_SYNC_INTERVAL_MS,
        ),
      ),
    );
    return { enabled, room, componentId, intervalMs };
  }, [
    argsSyncComponentId,
    argsSyncRoom,
    state.syncComponentId,
    state.syncIntervalMs,
    state.syncRoom,
    state.syncTimeline,
  ]);

  const publishScorecardSnapshot = useCallback((snapshot: ScorecardSyncSnapshot) => {
    latestScorecardSnapshotRef.current = snapshot;
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) return;
    iframeWindow.postMessage(
      {
        type: 'present:scorecard-sync',
        payload: snapshot,
      },
      '*',
    );
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      if (!scorecardSync.enabled) return;
      const snapshot = latestScorecardSnapshotRef.current;
      if (!snapshot) return;
      if (snapshot.room !== scorecardSync.room || snapshot.componentId !== scorecardSync.componentId) {
        return;
      }
      publishScorecardSnapshot(snapshot);
    };

    iframe.addEventListener('load', handleLoad);
    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, [publishScorecardSnapshot, scorecardSync.componentId, scorecardSync.enabled, scorecardSync.room]);

  useEffect(() => {
    if (scorecardSync.enabled) return;
    latestScorecardSnapshotRef.current = null;
    lastScorecardSyncSignatureRef.current = '';
  }, [scorecardSync.enabled]);

  useEffect(() => {
    lastScorecardSyncSignatureRef.current = '';
    latestScorecardSnapshotRef.current = null;
  }, [scorecardSync.componentId, scorecardSync.room]);

  useEffect(() => {
    if (!scorecardSync.enabled || !scorecardSync.room || !scorecardSync.componentId) return;

    let cancelled = false;
    let timer: number | null = null;
    let inflightController: AbortController | null = null;
    let consecutiveFailures = 0;

    const poll = async () => {
      let nextDelayMs = scorecardSync.intervalMs;
      inflightController = new AbortController();
      try {
        const search = new URLSearchParams({
          room: scorecardSync.room,
          componentId: scorecardSync.componentId,
        });
        const res = await fetchWithSupabaseAuth(`/api/steward/scorecard?${search.toString()}`, {
          cache: 'no-store',
          signal: inflightController.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`scorecard_sync_${res.status}`);
        }

        const payload = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (!payload?.ok || !isRecord(payload.scorecard)) return;
        const scorecard = payload.scorecard;
        const rawTimeline = Array.isArray(payload.timeline)
          ? payload.timeline
          : Array.isArray(scorecard.timeline)
            ? scorecard.timeline
            : [];
        const timeline = rawTimeline.filter((entry) => isRecord(entry)) as Array<
          Record<string, unknown>
        >;
        const version = coerceFiniteNumber(payload.version ?? scorecard.version);
        const lastUpdated = coerceFiniteNumber(payload.lastUpdated ?? scorecard.lastUpdated);
        const timelineFingerprint = buildTimelineFingerprint(timeline);
        const signature = `${scorecardSync.room}:${scorecardSync.componentId}:${
          version ?? 'na'
        }:${timelineFingerprint}`;
        if (signature === lastScorecardSyncSignatureRef.current) return;
        lastScorecardSyncSignatureRef.current = signature;

        const snapshot: ScorecardSyncSnapshot = {
          room: scorecardSync.room,
          componentId: scorecardSync.componentId,
          timeline,
          topic: coerceText(scorecard.topic),
          round: coerceText(scorecard.round),
          status: isRecord(scorecard.status) ? scorecard.status : undefined,
          version,
          lastUpdated,
          syncedAt: Date.now(),
        };

        publishScorecardSnapshot(snapshot);

        setState((prev) => {
          const prevArgs = isRecord(prev.args) ? prev.args : {};
          const nextArgs: Record<string, unknown> = {
            ...prevArgs,
            room: scorecardSync.room,
            componentId: scorecardSync.componentId,
            timeline,
            timelineTopic: snapshot.topic ?? prevArgs.timelineTopic,
            timelineRound: snapshot.round ?? prevArgs.timelineRound,
            timelineVersion:
              snapshot.version != null ? snapshot.version : prevArgs.timelineVersion,
            timelineLastUpdated:
              snapshot.lastUpdated != null
                ? snapshot.lastUpdated
                : prevArgs.timelineLastUpdated,
            timelineSyncedAt: snapshot.syncedAt,
            timelineStatus: snapshot.status ?? prevArgs.timelineStatus,
            timelineSyncStatus: 'ok',
            timelineSyncError: null,
            timelineSyncRetryMs: scorecardSync.intervalMs,
          };
          const nextRunId =
            snapshot.version != null
              ? `scorecard-sync:v:${snapshot.version}`
              : `scorecard-sync:f:${timelineFingerprint}`;
          if (
            stringifyArgs(nextArgs) === stringifyArgs(prev.args ?? {}) &&
            nextRunId === prev.runId
          ) {
            return prev;
          }
          return {
            ...prev,
            args: nextArgs,
            runId: nextRunId,
          };
        });
        consecutiveFailures = 0;
      } catch (syncError) {
        if (
          cancelled ||
          (syncError instanceof DOMException && syncError.name === 'AbortError')
        ) {
          return;
        }
        const errorMessage =
          syncError instanceof Error ? syncError.message : String(syncError ?? 'unknown_error');
        consecutiveFailures += 1;
        nextDelayMs = Math.min(
          scorecardSync.intervalMs * 2 ** Math.min(consecutiveFailures, 4),
          30_000,
        );
        setState((prev) => {
          const prevArgs = isRecord(prev.args) ? prev.args : {};
          if (
            prevArgs.timelineSyncStatus === 'error' &&
            prevArgs.timelineSyncError === errorMessage &&
            prevArgs.timelineSyncRetryMs === nextDelayMs
          ) {
            return prev;
          }
          return {
            ...prev,
            args: {
              ...prevArgs,
              timelineSyncStatus: 'error',
              timelineSyncError: errorMessage,
              timelineSyncErrorAt: Date.now(),
              timelineSyncRetryMs: nextDelayMs,
            },
          };
        });
        if (consecutiveFailures === 1 || consecutiveFailures % 5 === 0) {
          console.warn('[McpAppWidget] scorecard sync failed', {
            room: scorecardSync.room,
            componentId: scorecardSync.componentId,
            error: errorMessage,
            retryInMs: nextDelayMs,
            consecutiveFailures,
          });
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, nextDelayMs);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      inflightController?.abort();
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    publishScorecardSnapshot,
    scorecardSync.componentId,
    scorecardSync.enabled,
    scorecardSync.intervalMs,
    scorecardSync.room,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!resolvedResourceUri) return;
    setStatus('loading');
    setError(null);
    loadMcpAppResource({ resourceUri: resolvedResourceUri, serverUrl })
      .then((resource) => {
        if (cancelled) return;
        const html = injectCspMeta(resource.html, uiMeta.csp as string | undefined);
        setResourceHtml(html);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedResourceUri, serverUrl, uiMeta.csp]);

  const executeMcpTool = useCallback(
    async (tool: string, args: Record<string, unknown>) => {
      if (typeof window !== 'undefined' && (window as any).callMcpTool) {
        return await (window as any).callMcpTool(tool, args);
      }
      if (serverUrl) {
        return await callMcpMethod(serverUrl, 'tools/call', { name: tool, arguments: args });
      }
      throw new Error('mcp_tool_unavailable');
    },
    [serverUrl],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !resourceHtml) return;

    let transport: PostMessageTransport | null = null;
    let bridge: AppBridge | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let disconnected = false;

    const connectBridge = async () => {
      if (!iframe.contentWindow || disconnected) return;

      const theme: McpUiTheme = document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light';
      const displayMode = coerceDisplayMode(state.displayMode);

      const hostContext: McpUiHostContext = {
        toolInfo: toolDescriptor ? { tool: toolDescriptor } : undefined,
        theme,
        displayMode,
        availableDisplayModes: DEFAULT_DISPLAY_MODES,
        containerDimensions: containerRef.current
          ? {
              width: Math.round(containerRef.current.clientWidth || 0),
              height: Math.round(containerRef.current.clientHeight || 0),
            }
          : undefined,
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platform: 'web',
        deviceCapabilities: {
          touch: matchMedia('(pointer: coarse)').matches,
          hover: matchMedia('(hover: hover)').matches,
        },
      };

      bridge = new AppBridge(
        null,
        HOST_INFO,
        {
          openLinks: {},
          logging: {},
          serverTools: {},
          serverResources: {},
          updateModelContext: { text: {}, structuredContent: {} },
          message: { text: {}, structuredContent: {} },
          sandbox: {
            permissions: uiMeta.permissions as any,
          },
        },
        { hostContext },
      );

      bridge.onopenlink = async ({ url }) => {
        if (typeof url !== 'string') return {};
        const allowed = window.confirm ? window.confirm(`Open link?\n${url}`) : true;
        if (allowed) {
          window.open(url, '_blank', 'noopener');
        }
        return {};
      };

      bridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
        const text = extractTextFromContent(content as any);
        if (text || structuredContent) {
          window.dispatchEvent(
            new CustomEvent('context:document-added', {
              detail: {
                id: crypto.randomUUID(),
                title: state.title || state.toolName || 'MCP App Context',
                content: text || JSON.stringify(structuredContent, null, 2),
                type: 'markdown',
                timestamp: Date.now(),
                source: 'mcp',
              },
            }),
          );
        }
        return {};
      };

      bridge.onmessage = async () => ({});

      bridge.oncalltool = async ({ name, arguments: toolArgs }) => {
        const tool = name || state.toolName;
        if (!tool) {
          return normalizeToolResult('tool_name_missing', true);
        }
        const result = await executeMcpTool(tool, toolArgs ?? {});
        return normalizeToolResult(result);
      };

      bridge.onreadresource = async ({ uri }) => {
        if (!serverUrl) {
          throw new Error('mcp_server_missing');
        }
        const result = await callMcpMethod(serverUrl, 'resources/read', { uri });
        return result || { contents: [] };
      };

      bridge.onlistresources = async () => ({ resources: [] });

      bridge.oninitialized = () => {
        setBridgeReady(true);
      };

      transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);
      await bridge.connect(transport);
      bridgeRef.current = bridge;

      if (containerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          if (!bridge) return;
          if (!containerRef.current) return;
          bridge.setHostContext({
            ...hostContext,
            containerDimensions: {
              width: Math.round(containerRef.current.clientWidth || 0),
              height: Math.round(containerRef.current.clientHeight || 0),
            },
          });
        });
        resizeObserver.observe(containerRef.current);
      }
    };

    const handleLoad = () => {
      connectBridge().catch((err) => {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      });
    };

    iframe.addEventListener('load', handleLoad);
    if (iframe.contentDocument?.readyState === 'complete') {
      handleLoad();
    }

    return () => {
      disconnected = true;
      iframe.removeEventListener('load', handleLoad);
      if (resizeObserver) resizeObserver.disconnect();
      if (bridge) {
        bridge.teardownResource({}).catch(() => null);
      }
      if (transport) {
        transport.close().catch(() => null);
      }
      if (bridgeRef.current === bridge) {
        bridgeRef.current = null;
      }
      setBridgeReady(false);
    };
  }, [
    executeMcpTool,
    resourceHtml,
    serverUrl,
    state.displayMode,
    state.title,
    state.toolName,
    toolDescriptor,
    uiMeta.permissions,
  ]);

  const argsKey = useMemo(() => stringifyArgs(state.args), [state.args]);
  const autoRun = coerceBoolean(state.autoRun, true);

  useEffect(() => {
    if (!bridgeReady) return;
    if (!state.toolName) return;
    if (!autoRun && !state.runId) return;

    const runKey = `${state.toolName}:${argsKey}:${state.runId || ''}`;
    if (runKey === lastRunKeyRef.current) return;
    lastRunKeyRef.current = runKey;

    const run = async () => {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      try {
        await bridge.sendToolInput({ arguments: state.args || {} });
        const result = await executeMcpTool(state.toolName!, state.args || {});
        await bridge.sendToolResult(normalizeToolResult(result));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await bridge.sendToolResult(normalizeToolResult(message, true));
      }
    };

    run();
  }, [bridgeReady, state.toolName, argsKey, autoRun, state.runId, executeMcpTool, state.args]);

  const title = state.title || state.toolName || 'MCP App';
  const allowAttr = buildAllowAttribute(uiMeta.permissions as any);

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-lg',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-white/70">
        <span className="font-semibold text-white/80">{title}</span>
        <span className="uppercase tracking-wide">
          {status === 'loading' ? 'Loading' : status === 'error' ? 'Error' : 'Ready'}
        </span>
      </div>
      {status === 'error' ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-red-200">
          {error || 'Failed to load MCP app'}
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          title={title}
          className="h-full w-full flex-1 bg-white"
          sandbox="allow-scripts"
          allow={allowAttr || undefined}
          srcDoc={resourceHtml}
        />
      )}
    </div>
  );
}

export default McpAppWidget;
