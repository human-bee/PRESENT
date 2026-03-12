'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {
  McpUiDisplayMode,
  McpUiHostContext,
  McpUiTheme,
} from '@modelcontextprotocol/ext-apps';
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
  preferredWidth?: number;
  preferredHeight?: number;
  minWidth?: number;
  minHeight?: number;
  autoFitWidth?: boolean;
  autoFitHeight?: boolean;
  sizingPolicyOverride?: 'always_fit' | 'fit_until_user_resize' | 'scale_only';
  syncSource?: 'timeline';
  syncRoom?: string;
  syncComponentId?: string;
  syncIntervalMs?: number;
  autoRun?: boolean;
  runId?: string;
  displayMode?: string;
  className?: string;
  contextKey?: string;
};

type TimelineSyncSnapshot = {
  room: string;
  componentId: string;
  document: Record<string, unknown>;
  version?: number;
  lastUpdated?: number;
  syncedAt: number;
};

type ReportedMcpAppLayout = {
  width?: number;
  height?: number;
};

const HOST_INFO = { name: 'PRESENT', version: '0.1.0' };
const DEFAULT_DISPLAY_MODES: McpUiDisplayMode[] = ['inline', 'pip', 'fullscreen'];
const DEFAULT_TIMELINE_SYNC_INTERVAL_MS = 3000;

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

const buildTimelineFingerprint = (document: Record<string, unknown>): string => {
  const lanes = Array.isArray(document.lanes) ? document.lanes.length : 0;
  const items = Array.isArray(document.items) ? document.items.length : 0;
  const dependencies = Array.isArray(document.dependencies) ? document.dependencies.length : 0;
  const events = Array.isArray(document.events) ? document.events.length : 0;
  const lastUpdated = coerceFiniteNumber(document.lastUpdated) ?? -1;
  return `${lanes}:${items}:${dependencies}:${events}:${lastUpdated}`;
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
    updateState,
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
    preferredWidth: rest.preferredWidth,
    preferredHeight: rest.preferredHeight,
    minWidth: rest.minWidth,
    minHeight: rest.minHeight,
    autoFitWidth: rest.autoFitWidth,
    autoFitHeight: rest.autoFitHeight,
    sizingPolicyOverride: rest.sizingPolicyOverride,
    syncSource: rest.syncSource,
    syncRoom: rest.syncRoom,
    syncComponentId: rest.syncComponentId,
    syncIntervalMs: rest.syncIntervalMs,
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
  const latestTimelineSnapshotRef = useRef<TimelineSyncSnapshot | null>(null);
  const lastTimelineSyncSignatureRef = useRef<string>('');
  const lastReportedLayoutRef = useRef<ReportedMcpAppLayout | null>(null);

  const registryProps = useMemo(
    () => ({
      title: state.title,
      toolName: state.toolName,
      serverUrl: state.serverUrl,
      serverName: state.serverName,
      resourceUri: state.resourceUri,
      args: state.args,
      preferredWidth: state.preferredWidth,
      preferredHeight: state.preferredHeight,
      minWidth: state.minWidth,
      minHeight: state.minHeight,
      autoFitWidth: state.autoFitWidth,
      autoFitHeight: state.autoFitHeight,
      sizingPolicyOverride: state.sizingPolicyOverride,
      syncSource: state.syncSource,
      syncRoom: state.syncRoom,
      syncComponentId: state.syncComponentId,
      syncIntervalMs: state.syncIntervalMs,
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
      args:
        typeof patch.args === 'object' && patch.args
          ? (patch.args as Record<string, unknown>)
          : prev.args,
      preferredWidth:
        typeof patch.preferredWidth === 'number' && Number.isFinite(patch.preferredWidth)
          ? patch.preferredWidth
          : prev.preferredWidth,
      preferredHeight:
        typeof patch.preferredHeight === 'number' && Number.isFinite(patch.preferredHeight)
          ? patch.preferredHeight
          : prev.preferredHeight,
      minWidth:
        typeof patch.minWidth === 'number' && Number.isFinite(patch.minWidth)
          ? patch.minWidth
          : prev.minWidth,
      minHeight:
        typeof patch.minHeight === 'number' && Number.isFinite(patch.minHeight)
          ? patch.minHeight
          : prev.minHeight,
      autoFitWidth:
        typeof patch.autoFitWidth === 'boolean' ? patch.autoFitWidth : prev.autoFitWidth,
      autoFitHeight:
        typeof patch.autoFitHeight === 'boolean' ? patch.autoFitHeight : prev.autoFitHeight,
      sizingPolicyOverride:
        patch.sizingPolicyOverride === 'always_fit' ||
        patch.sizingPolicyOverride === 'fit_until_user_resize' ||
        patch.sizingPolicyOverride === 'scale_only'
          ? patch.sizingPolicyOverride
          : prev.sizingPolicyOverride,
      syncSource: patch.syncSource === 'timeline' ? 'timeline' : prev.syncSource,
      syncRoom: typeof patch.syncRoom === 'string' ? patch.syncRoom : prev.syncRoom,
      syncComponentId:
        typeof patch.syncComponentId === 'string' ? patch.syncComponentId : prev.syncComponentId,
      syncIntervalMs:
        typeof patch.syncIntervalMs === 'number' && Number.isFinite(patch.syncIntervalMs)
          ? patch.syncIntervalMs
          : prev.syncIntervalMs,
      autoRun: typeof patch.autoRun === 'boolean' ? patch.autoRun : prev.autoRun,
      runId: typeof patch.runId === 'string' ? patch.runId : prev.runId,
      displayMode: typeof patch.displayMode === 'string' ? patch.displayMode : prev.displayMode,
    }));
  }, []);

  useComponentRegistration(
    messageId,
    'McpAppWidget',
    registryProps,
    contextKey || 'canvas',
    applyPatch,
  );

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
  const argsSyncComponentId = coerceText(state.args?.componentId);
  const argsSyncRefreshKey = coerceText(state.args?.timelineRefreshKey);
  const timelineSync = useMemo(() => {
    const room = coerceText(state.syncRoom) ?? argsSyncRoom;
    const componentId = coerceText(state.syncComponentId) ?? argsSyncComponentId;
    const enabled = state.syncSource === 'timeline';
    const intervalMs = Math.max(
      1000,
      Math.min(
        30_000,
        Math.round(coerceFiniteNumber(state.syncIntervalMs) ?? DEFAULT_TIMELINE_SYNC_INTERVAL_MS),
      ),
    );
    return { enabled, room, componentId, intervalMs };
  }, [
    argsSyncComponentId,
    argsSyncRoom,
    state.syncComponentId,
    state.syncIntervalMs,
    state.syncRoom,
    state.syncSource,
  ]);

  const publishTimelineSnapshot = useCallback((snapshot: TimelineSyncSnapshot) => {
    latestTimelineSnapshotRef.current = snapshot;
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow) return;
    iframeWindow.postMessage(
      {
        type: 'present:timeline-sync',
        payload: snapshot,
      },
      '*',
    );
  }, []);

  useEffect(() => {
    if (!updateState) return;

    if (state.syncSource === 'timeline') {
      updateState((prevState) => {
        const current = isRecord(prevState) ? prevState : {};
        const next = { ...current };
        let changed = false;
        if (next.autoFitWidth !== false) {
          next.autoFitWidth = false;
          changed = true;
        }
        if (next.sizingPolicyOverride !== 'always_fit') {
          next.sizingPolicyOverride = 'always_fit';
          changed = true;
        }
        if ('reportedContentWidth' in next) {
          delete next.reportedContentWidth;
          changed = true;
        }
        return changed ? next : current;
      });
    }

    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;
      const data = event.data;
      if (!isRecord(data) || data.type !== 'present:mcp-app-layout') return;
      const payload = isRecord(data.payload) ? data.payload : data;
      const nextWidth =
        state.syncSource === 'timeline'
          ? undefined
          : coerceFiniteNumber(payload.width ?? payload.contentWidth);
      const nextHeight = coerceFiniteNumber(payload.height ?? payload.contentHeight);
      if (nextWidth == null && nextHeight == null) return;

      const roundedWidth = nextWidth != null ? Math.max(1, Math.ceil(nextWidth)) : undefined;
      const roundedHeight = nextHeight != null ? Math.max(1, Math.ceil(nextHeight)) : undefined;
      const prev = lastReportedLayoutRef.current;
      const widthChanged =
        roundedWidth != null && Math.abs((prev?.width ?? roundedWidth) - roundedWidth) > 4;
      const heightChanged =
        roundedHeight != null && Math.abs((prev?.height ?? roundedHeight) - roundedHeight) > 4;
      if (!widthChanged && !heightChanged && prev) return;

      lastReportedLayoutRef.current = {
        width: roundedWidth ?? prev?.width,
        height: roundedHeight ?? prev?.height,
      };

      updateState((prevState) => {
        const current = isRecord(prevState) ? prevState : {};
        const currentWidth = coerceFiniteNumber(current.reportedContentWidth);
        const currentHeight = coerceFiniteNumber(current.reportedContentHeight);
        if (
          (roundedWidth == null || currentWidth === roundedWidth) &&
          (roundedHeight == null || currentHeight === roundedHeight)
        ) {
          return current;
        }
        return {
          ...current,
          ...(roundedWidth != null ? { reportedContentWidth: roundedWidth } : {}),
          ...(roundedHeight != null ? { reportedContentHeight: roundedHeight } : {}),
          reportedLayoutAt: Date.now(),
        };
      });
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [state.syncSource, updateState]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      if (!timelineSync.enabled) return;
      const snapshot = latestTimelineSnapshotRef.current;
      if (!snapshot) return;
      if (
        snapshot.room !== timelineSync.room ||
        snapshot.componentId !== timelineSync.componentId
      ) {
        return;
      }
      publishTimelineSnapshot(snapshot);
    };

    iframe.addEventListener('load', handleLoad);
    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, [publishTimelineSnapshot, timelineSync.componentId, timelineSync.enabled, timelineSync.room]);

  useEffect(() => {
    if (timelineSync.enabled) return;
    latestTimelineSnapshotRef.current = null;
    lastTimelineSyncSignatureRef.current = '';
  }, [timelineSync.enabled]);

  useEffect(() => {
    lastTimelineSyncSignatureRef.current = '';
    latestTimelineSnapshotRef.current = null;
  }, [timelineSync.componentId, timelineSync.room]);

  useEffect(() => {
    const syncRoom = timelineSync.room;
    const syncComponentId = timelineSync.componentId;
    if (!timelineSync.enabled || !syncRoom || !syncComponentId) return;

    let cancelled = false;
    let timer: number | null = null;
    let inflightController: AbortController | null = null;
    let consecutiveFailures = 0;

    const poll = async () => {
      let nextDelayMs = timelineSync.intervalMs;
      inflightController = new AbortController();
      try {
        const search = new URLSearchParams({
          room: syncRoom,
          componentId: syncComponentId,
        });
        const res = await fetchWithSupabaseAuth(`/api/steward/timeline?${search.toString()}`, {
          cache: 'no-store',
          signal: inflightController.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`timeline_sync_${res.status}`);
        }

        const payload = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (!payload?.ok || !isRecord(payload.document)) return;
        const document = payload.document;
        const version = coerceFiniteNumber(payload.version ?? document.version);
        const lastUpdated = coerceFiniteNumber(payload.lastUpdated ?? document.lastUpdated);
        const timelineFingerprint = buildTimelineFingerprint(document);
        const signature = `${syncRoom}:${syncComponentId}:${version ?? 'na'}:${timelineFingerprint}`;
        const latestSnapshot = latestTimelineSnapshotRef.current;
        const latestDocument =
          latestSnapshot &&
          latestSnapshot.room === syncRoom &&
          latestSnapshot.componentId === syncComponentId &&
          isRecord(latestSnapshot.document)
            ? latestSnapshot.document
            : null;
        const recoveringFromClientSyncError =
          isRecord(latestDocument?.sync) && latestDocument.sync.status === 'error';
        if (
          signature === lastTimelineSyncSignatureRef.current &&
          !recoveringFromClientSyncError
        )
          return;
        lastTimelineSyncSignatureRef.current = signature;

        const snapshot: TimelineSyncSnapshot = {
          room: syncRoom,
          componentId: syncComponentId,
          document,
          version,
          lastUpdated,
          syncedAt: Date.now(),
        };

        publishTimelineSnapshot(snapshot);

        setState((prev) => {
          const prevArgs = isRecord(prev.args) ? prev.args : {};
          const nextSyncStatus =
            isRecord(document.sync) && typeof document.sync.status === 'string'
              ? document.sync.status
              : 'live';
          const nextArgs: Record<string, unknown> = {
            ...prevArgs,
            room: syncRoom,
            componentId: syncComponentId,
            timelineTitle: coerceText(document.title) ?? prevArgs.timelineTitle,
            timelineSubtitle: coerceText(document.subtitle) ?? prevArgs.timelineSubtitle,
            timelineVersion: snapshot.version != null ? snapshot.version : prevArgs.timelineVersion,
            timelineLastUpdated:
              snapshot.lastUpdated != null ? snapshot.lastUpdated : prevArgs.timelineLastUpdated,
            timelineSyncedAt: snapshot.syncedAt,
            timelineSyncState:
              isRecord(document.sync) && typeof document.sync.status === 'string'
                ? document.sync.status
                : prevArgs.timelineSyncState,
            timelinePendingExportCount:
              isRecord(document.sync) && Array.isArray(document.sync.pendingExports)
                ? document.sync.pendingExports.length
                : prevArgs.timelinePendingExportCount,
            timelineExportStages:
              isRecord(document.sync) && Array.isArray(document.sync.pendingExports)
                ? document.sync.pendingExports
                : prevArgs.timelineExportStages,
            timelineSyncStatus: nextSyncStatus,
            timelineSyncError: null,
            timelineSyncRetryMs: timelineSync.intervalMs,
          };
          if (stringifyArgs(nextArgs) === stringifyArgs(prev.args ?? {})) {
            return prev;
          }
          return {
            ...prev,
            args: nextArgs,
          };
        });
        consecutiveFailures = 0;
      } catch (syncError) {
        if (cancelled || (syncError instanceof DOMException && syncError.name === 'AbortError')) {
          return;
        }
        const errorMessage =
          syncError instanceof Error ? syncError.message : String(syncError ?? 'unknown_error');
        consecutiveFailures += 1;
        nextDelayMs = Math.min(
          timelineSync.intervalMs * 2 ** Math.min(consecutiveFailures, 4),
          30_000,
        );
        const latestSnapshot = latestTimelineSnapshotRef.current;
        if (
          latestSnapshot &&
          latestSnapshot.room === syncRoom &&
          latestSnapshot.componentId === syncComponentId
        ) {
          const latestDocument = isRecord(latestSnapshot.document) ? latestSnapshot.document : {};
          const nextDocument = {
            ...latestDocument,
            sync: {
              ...(isRecord(latestDocument.sync) ? latestDocument.sync : {}),
              status: 'error',
              lastError: errorMessage,
              retryMs: nextDelayMs,
            },
          };
          publishTimelineSnapshot({
            ...latestSnapshot,
            document: nextDocument,
            syncedAt: Date.now(),
          });
        }
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
          console.warn('[McpAppWidget] timeline sync failed', {
            room: syncRoom,
            componentId: syncComponentId,
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
    argsSyncRefreshKey,
    publishTimelineSnapshot,
    timelineSync.componentId,
    timelineSync.enabled,
    timelineSync.intervalMs,
    timelineSync.room,
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
  const timelineShellStatus = useMemo(() => {
    const explicitSyncError = coerceText(state.args?.timelineSyncError);
    if (explicitSyncError) return 'Sync error';
    const explicitSyncStatus =
      coerceText(state.args?.timelineSyncStatus) ?? coerceText(state.args?.timelineSyncState);
    if (explicitSyncStatus) {
      return `Sync ${explicitSyncStatus.replace(/_/g, ' ')}`;
    }
    return 'Sync idle';
  }, [state.args]);

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
  const showHostChrome = !timelineSync.enabled;

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-lg',
        className,
      )}
    >
      {showHostChrome ? (
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-white/70">
          <span className="font-semibold text-white/80">{title}</span>
          <span className="uppercase tracking-wide">
            {status === 'loading'
              ? 'Loading'
              : status === 'error'
                ? 'Error'
                : timelineSync.enabled
                  ? timelineShellStatus
                  : 'Ready'}
          </span>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-red-200">
          {error || 'Failed to load MCP app'}
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          title={title}
          className="block min-h-0 w-full flex-1 bg-white"
          sandbox="allow-scripts"
          allow={allowAttr || undefined}
          srcDoc={resourceHtml}
        />
      )}
    </div>
  );
}

export default McpAppWidget;
