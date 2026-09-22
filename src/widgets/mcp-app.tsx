import { useCallback, useEffect, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport, type McpUiResourceCsp } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult, ReadResourceResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { mcpAppSchema } from '../../shared/mcp-app';
import type { RoomObject } from '../../shared/room';

type OpenApp = { html: string; csp: McpUiResourceCsp; sandboxUrl: string; appSession: string; tool: Tool; result: CallToolResult | null; ref: { toolInput: Record<string, unknown> } };
export type McpAppProps = { roomId: string; object: RoomObject; selfId: string };
export function McpApp({ roomId, object, selfId }: McpAppProps) {
  const container = useRef<HTMLDivElement>(null), bridge = useRef<AppBridge | null>(null);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [error, setError] = useState(''), [contextStatus, setContextStatus] = useState('');
  const pendingRun = useRef<string | null>(null), busy = useRef(false), alive = useRef(false), appCallsEnabled = useRef(false);
  const appSession = useRef<string | null>(null), [connection, reconnect] = useState(0);
  const reference = mcpAppSchema.safeParse(object.data), referenceKey = reference.success ? JSON.stringify(reference.data) : '';
  const request = useCallback(async <T,>(action: string, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`/api/mcp/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, objectId: object.id, actor: selfId, ...(action !== 'open' ? { appSession: appSession.current } : {}), ...extra }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The app request failed.');
    return result as T;
  }, [roomId, object.id, selfId]);

  useEffect(() => {
    // This counter deliberately invalidates the lifecycle when the user reconnects.
    void connection;
    if (!referenceKey || !selfId) return;
    let disposed = false, current: AppBridge | undefined, frame: HTMLIFrameElement | undefined, observer: ResizeObserver | undefined, initTimer: number | undefined;
    const controller = new AbortController(); alive.current = true; appCallsEnabled.current = false; pendingRun.current = null; appSession.current = null; busy.current = false;
    setReady(false); setRunning(false); setError(''); setContextStatus('');
    void (async () => {
      try {
        const app = await request<OpenApp>('open', {}, controller.signal);
        if (disposed || !container.current) return;
        appSession.current = app.appSession;
        const sandbox = new URL(app.sandboxUrl), expected = new URL(location.origin); expected.hostname = 'localhost';
        if (location.hostname !== '127.0.0.1' || sandbox.origin !== expected.origin || !/^\/mcp\/sandbox\/[a-f0-9]{48}$/.test(sandbox.pathname)) throw new Error('This app needs the isolated local sandbox origin.');
        frame = document.createElement('iframe'); frame.title = `${app.tool.title ?? app.tool.name} MCP App`; frame.sandbox.add('allow-scripts', 'allow-same-origin'); frame.referrerPolicy = 'no-referrer'; frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
        container.current.replaceChildren(frame);
        current = new AppBridge(null, { name: 'PRESENT', version: '0.1.0' }, { serverTools: {}, serverResources: {}, updateModelContext: { text: {} } }, { hostContext: { theme: 'light', platform: 'web', displayMode: 'inline', availableDisplayModes: ['inline'], toolInfo: { tool: app.tool }, containerDimensions: { width: container.current.clientWidth, height: container.current.clientHeight } } });
        bridge.current = current;
        current.oncalltool = async (params, extra) => {
          if (disposed) throw new Error('This app connection has closed.');
          if (!appCallsEnabled.current) throw new Error('Run this app once to enable its tool interactions.');
          return request<CallToolResult>('call', { appSession: app.appSession, name: params.name, arguments: params.arguments ?? {}, requestId: crypto.randomUUID() }, AbortSignal.any([controller.signal, extra.signal]));
        };
        current.onreadresource = (params, extra) => request<ReadResourceResult>('resource', { appSession: app.appSession, uri: params.uri }, AbortSignal.any([controller.signal, extra.signal]));
        current.onupdatemodelcontext = async (context, extra) => {
          await request('context', { appSession: app.appSession, context }, AbortSignal.any([controller.signal, extra.signal]));
          if (!disposed) setContextStatus('App context available to PRESENT'); return {};
        };
        current.onrequestdisplaymode = async () => ({ mode: 'inline' });
        current.oninitialized = async () => {
          if (disposed || !current) return;
          window.clearTimeout(initTimer); setReady(true);
          await current.sendToolInput({ arguments: app.ref.toolInput });
          if (app.result) await current.sendToolResult(app.result);
        };
        current.onsandboxready = async () => { if (!disposed && current) await current.sendSandboxResourceReady({ html: app.html, csp: app.csp, permissions: {}, sandbox: 'allow-scripts' }); };
        current.onerror = () => { if (!disposed) setError('The app connection encountered an error. Reopen the app to reconnect.'); };
        const target = frame.contentWindow; if (!target) throw new Error('The app frame could not be created.');
        await current.connect(new PostMessageTransport(target, target));
        if (disposed) return;
        observer = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect && current) current.setHostContext({ theme: 'light', platform: 'web', displayMode: 'inline', availableDisplayModes: ['inline'], toolInfo: { tool: app.tool }, containerDimensions: { width: Math.round(rect.width), height: Math.round(rect.height) } }); });
        observer.observe(container.current);
        initTimer = window.setTimeout(() => { if (!disposed) setError('This app did not finish its MCP initialization.'); }, 15000);
        frame.src = app.sandboxUrl;
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : 'The app could not open.'); }
    })();
    return () => {
      disposed = true; alive.current = false; controller.abort(); window.clearTimeout(initTimer); observer?.disconnect();
      if (bridge.current === current) bridge.current = null;
      if (current) void current.teardownResource({}, { timeout: 350 }).catch(() => {}).finally(() => { void current?.close(); frame?.remove(); });
      else frame?.remove();
    };
  }, [request, selfId, referenceKey, connection]);

  async function run() {
    if (!ready || busy.current || !bridge.current) return;
    const invocationBridge = bridge.current;
    busy.current = true; setRunning(true); setError('');
    pendingRun.current ??= crypto.randomUUID(); appCallsEnabled.current = true;
    try {
      const result = await request<CallToolResult>('run', { requestId: pendingRun.current });
      if (alive.current && bridge.current === invocationBridge) { await invocationBridge.sendToolResult(result); pendingRun.current = null; }
    } catch (cause) { if (alive.current && bridge.current === invocationBridge) setError(cause instanceof Error ? cause.message : 'The app run could not complete.'); }
    finally { if (bridge.current === invocationBridge) { busy.current = false; if (alive.current) setRunning(false); } }
  }
  if (!reference.success) return <p role="alert">This app reference is invalid.</p>;
  return <section aria-label="MCP App" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fffef9' }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #e1e5d9' }}>
      <button type="button" className="widget-primary" disabled={!ready || running} onClick={() => void run()}>{running ? 'Running…' : 'Run app'}</button>
      <button type="button" className="widget-quiet" disabled={running} onClick={() => reconnect(value => value + 1)}>Reconnect</button>
      <span role="status">{ready ? contextStatus || 'Ready' : 'Opening app…'}</span>
    </div>
    {error && <p role="alert" style={{ margin: 0, padding: '8px 12px', color: '#9b493c', fontSize: 12 }}>{error}</p>}
    <div ref={container} style={{ flex: 1, minHeight: 0 }} />
  </section>;
}
