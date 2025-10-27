"use client";

import { createContext, useContext, type ReactNode, useMemo, useEffect } from 'react';
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
  stewardEnabled?: boolean;
}

export function ToolDispatcher({
  children,
  contextKey,
  enableLogging = true,
  stewardEnabled,
}: ToolDispatcherProps) {
  const room = useRoomContext();
  const events = useToolEvents(room, { enableLogging });
  const envFlag = process.env.NEXT_PUBLIC_STEWARD_FLOWCHART_ENABLED;
  const defaultStewardEnabled = envFlag === undefined ? true : envFlag === 'true';
  const resolvedStewardEnabled = stewardEnabled ?? defaultStewardEnabled;
  const { executeToolCall } = useToolRunner({
    contextKey,
    events,
    room,
    stewardEnabled: resolvedStewardEnabled,
  });

  // Listen for unified Canvas Agent action envelopes and ack
  // Idempotency set lives within the TLDraw canvas bridge; here we route envelopes to window for handlers
  useEffect(() => {
    const off = events.bus.on('agent:action', async (message: any) => {
      try {
        if (!message || message.type !== 'agent:action') return;
        const envelope = message.envelope;
        window.dispatchEvent(new CustomEvent('present:agent_actions', { detail: envelope }));
        // Post ack to server inbox with (sessionId, seq)
        try {
          await fetch('/api/canvas-agent/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: envelope.sessionId, seq: envelope.seq }),
          });
        } catch {}
      } catch {}
    });
    return () => { off?.(); };
  }, [events.bus]);

  const value = useMemo<DispatcherContext>(() => ({ executeToolCall }), [executeToolCall]);

  return <ToolDispatcherContext.Provider value={value}>{children}</ToolDispatcherContext.Provider>;
}
