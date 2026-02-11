"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport, buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiDisplayMode, McpUiHostContext, McpUiTheme } from '@modelcontextprotocol/ext-apps';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import { waitForMcpReady } from '@/lib/mcp-bridge';
import { resolveMcpServer, getMcpServerUrl } from '@/lib/mcp-apps/server-utils';
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
  autoRun?: boolean;
  runId?: string;
  displayMode?: string;
  className?: string;
  contextKey?: string;
};

const HOST_INFO = { name: 'PRESENT', version: '0.1.0' };
const DEFAULT_DISPLAY_MODES: McpUiDisplayMode[] = ['inline', 'pip', 'fullscreen'];

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

  const registryProps = useMemo(
    () => ({
      title: state.title,
      toolName: state.toolName,
      serverUrl: state.serverUrl,
      serverName: state.serverName,
      resourceUri: state.resourceUri,
      args: state.args,
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
  }, [resourceHtml, serverUrl, state.displayMode, state.title, state.toolName, toolDescriptor, uiMeta.permissions]);

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
