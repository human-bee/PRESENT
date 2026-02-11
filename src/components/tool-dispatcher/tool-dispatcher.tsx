"use client";

import { createContext, useContext, type ReactNode, useMemo, useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import type { DispatcherContext } from './utils';
import { useToolEvents, useToolRunner } from './hooks';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { resolveEdgeIngressUrl } from '@/lib/edge-ingress';

// Exported so fixture routes (e.g. /showcase/ui) can provide a no-op dispatcher
// without pulling in LiveKit room context.
export const ToolDispatcherContext = createContext<DispatcherContext | null>(null);

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
  enableLogging = false,
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
  const tokenCacheRef = useRef(new Map<string, { token: string; exp: number }>());

  // Listen for unified Canvas Agent action envelopes and ack
  // Idempotency set lives within the TLDraw canvas bridge; here we route envelopes to window for handlers
  useEffect(() => {
    if (!room) return;
    const cache = tokenCacheRef.current;
    const ensureToken = async (sessionId: string): Promise<string | undefined> => {
      if (!sessionId) return undefined;
      const now = Date.now();
      const cached = cache.get(sessionId);
      if (cached && cached.exp - now > 5_000) {
        (window as any).__presentCanvasAgentToken = cached.token;
        (window as any).__presentCanvasAgentSessionId = sessionId;
        return cached.token;
      }
      const roomName = room?.name;
      if (!roomName) return undefined;
      try {
        const url = `/api/canvas-agent/token?sessionId=${encodeURIComponent(sessionId)}&roomId=${encodeURIComponent(roomName)}`;
        const res = await fetchWithSupabaseAuth(url);
        if (!res.ok) return undefined;
        const json = await res.json();
        const token = typeof json?.token === 'string' ? json.token : undefined;
        const exp = typeof json?.exp === 'number' ? json.exp : now + 60_000;
        if (!token) return undefined;
        cache.set(sessionId, { token, exp });
        (window as any).__presentCanvasAgentToken = token;
        (window as any).__presentCanvasAgentSessionId = sessionId;
        return token;
      } catch {
        return undefined;
      }
    };

    const off = events.bus.on('agent:action', (message: any) => {
      try {
        if (!message || message.type !== 'agent:action') return;
        const envelope = message.envelope;
        if (enableLogging && typeof window !== 'undefined') {
          try {
            console.debug('[ToolDispatcher] agent:action received', {
              room: room?.name,
              sessionId: envelope?.sessionId,
              seq: envelope?.seq,
              actionCount: Array.isArray(envelope?.actions) ? envelope.actions.length : 0,
            });
          } catch {}
        }
        window.dispatchEvent(new CustomEvent('present:agent_actions', { detail: envelope }));
        void (async () => {
          const token = await ensureToken(envelope.sessionId);
          if (!token) return;
          try {
            const clientId = room?.localParticipant?.identity || 'unknown';
            const roomId = room?.name || '';
            await fetchWithSupabaseAuth(resolveEdgeIngressUrl('/api/canvas-agent/ack'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: envelope.sessionId,
                seq: envelope.seq,
                clientId,
                roomId,
                token,
                ts: Date.now(),
              }),
              keepalive: true,
            });
          } catch {}
        })();
      } catch {}
    });

    return () => { off?.(); };
  }, [events.bus, room, enableLogging]);

  useEffect(() => {
    if (!room) return;
    const off = events.bus.on('agent:status', (message: any) => {
      try {
        if (!message || message.type !== 'agent:status') return;
        window.dispatchEvent(new CustomEvent('present:agent_status', { detail: message }));
      } catch {}
    });
    return () => { off?.(); };
  }, [events.bus, room]);

  const value = useMemo<DispatcherContext>(() => ({ executeToolCall }), [executeToolCall]);

  return <ToolDispatcherContext.Provider value={value}>{children}</ToolDispatcherContext.Provider>;
}
