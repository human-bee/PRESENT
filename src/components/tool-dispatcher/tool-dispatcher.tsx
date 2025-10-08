"use client";

import { createContext, useContext, type ReactNode, useMemo } from 'react';
import { useRoomContext } from '@livekit/components-react';
import type { DispatcherContext } from './utils';
import { useToolEvents, useToolRunner } from './hooks';

const ToolDispatcherContext = createContext<DispatcherContext | null>(null);

export function useToolDispatcher(): DispatcherContext {
  const ctx = useContext(ToolDispatcherContext);
  if (!ctx) {
    throw new Error('useToolDispatcher must be used within ToolDispatcher');
  }
  return ctx;
}

export interface ToolDispatcherProps {
  children: ReactNode;
  contextKey?: string;
  enableLogging?: boolean;
}

export function ToolDispatcher({
  children,
  contextKey,
  enableLogging = false,
}: ToolDispatcherProps) {
  const room = useRoomContext();
  const events = useToolEvents(room, { enableLogging });
  const { executeToolCall } = useToolRunner({
    contextKey,
    events,
    room,
    stewardEnabled: true,
  });

  const value = useMemo<DispatcherContext>(() => ({ executeToolCall }), [executeToolCall]);

  return <ToolDispatcherContext.Provider value={value}>{children}</ToolDispatcherContext.Provider>;
}
