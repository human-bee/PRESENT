"use client";

import * as React from 'react';
import type { DispatcherContext, ToolCall, ToolRunResult } from './utils/toolTypes';
import { ToolDispatcherContext } from './tool-dispatcher';

/**
 * ToolDispatcherStub
 *
 * Used by dev-only fixture routes (e.g. /showcase/ui) where we want to render
 * components that call `useToolDispatcher()` without wiring LiveKit / tool bus.
 */
export function ToolDispatcherStub({ children }: { children: React.ReactNode }) {
  const executeToolCall = React.useCallback(async (_call: ToolCall): Promise<ToolRunResult> => {
    return {
      status: 'error',
      message: 'Tool dispatcher is disabled in /showcase fixtures.',
    };
  }, []);

  const value = React.useMemo<DispatcherContext>(() => ({ executeToolCall }), [executeToolCall]);
  return <ToolDispatcherContext.Provider value={value}>{children}</ToolDispatcherContext.Provider>;
}

