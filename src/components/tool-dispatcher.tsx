/**
 * ToolDispatcher
 *
 * Minimal first-principles dispatcher that exposes a context + hook
 * and handles a small set of tool calls needed by the UI.
 *
 * Responsibilities now:
 * - Provide `useToolDispatcher()` with `executeToolCall` function
 * - For `generate_ui_component`, dispatch a browser event that the
 *   thread UI listens to (custom:showComponent)
 * - Optionally expose a global bridge used by the MCP layer
 */

'use client';

import * as React from 'react';

type ToolCall = {
  id: string;
  roomId?: string;
  type: 'tool_call';
  payload: { tool: string; params?: Record<string, unknown> };
  timestamp?: number;
  source?: string;
};

type DispatcherContext = {
  executeToolCall: (call: ToolCall) => Promise<{ status: string; message?: string }>;
};

const Ctx = React.createContext<DispatcherContext | null>(null);

export function useToolDispatcher(): DispatcherContext {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useToolDispatcher must be used within ToolDispatcher');
  return ctx;
}

export function ToolDispatcher({
  children,
  contextKey,
  enableLogging = false,
}: {
  children: React.ReactNode;
  contextKey?: string;
  enableLogging?: boolean;
}) {
  const log = (...args: any[]) => enableLogging && console.log('[ToolDispatcher]', ...args);

  const executeToolCall = React.useCallback<DispatcherContext['executeToolCall']>(
    async (call) => {
      const { tool, params = {} } = call.payload || ({} as any);
      log('call', tool, params);

      try {
        if (tool === 'generate_ui_component') {
          const componentType = String((params as any)?.componentType || 'Message');
          const messageId = `ui-${componentType.toLowerCase()}-${Date.now()}`;
          // Let the thread listener materialize this component
          try {
            window.dispatchEvent(
              new CustomEvent('custom:showComponent', {
                detail: {
                  messageId,
                  component: { type: componentType, props: { _custom_displayMessage: true } },
                  contextKey,
                },
              }),
            );
          } catch {}
          return { status: 'SUCCESS', message: `Rendered ${componentType}` };
        }

        // Future: route canvas_* tools to TLDraw events, mcp_* to MCP bridge, etc.
        return { status: 'IGNORED', message: `No handler for tool '${tool}'` };
      } catch (e) {
        console.error('[ToolDispatcher] error executing tool', tool, e);
        return { status: 'ERROR', message: e instanceof Error ? e.message : 'Unknown error' };
      }
    },
    [contextKey, enableLogging],
  );

  // Optional: expose global bridge, so other parts can reuse dispatcher
  React.useEffect(() => {
    const globalAny = window as any;
    globalAny.__custom_tool_dispatcher = {
      executeMCPTool: async (tool: string, params: any) => {
        return executeToolCall({
          id: crypto.randomUUID?.() || String(Date.now()),
          type: 'tool_call',
          payload: { tool, params },
          timestamp: Date.now(),
          source: 'global-bridge',
        });
      },
    };
    return () => {
      if (globalAny.__custom_tool_dispatcher) delete globalAny.__custom_tool_dispatcher;
    };
  }, [executeToolCall]);

  return <Ctx.Provider value={{ executeToolCall }}>{children}</Ctx.Provider>;
}

