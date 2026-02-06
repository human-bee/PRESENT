"use client";

import { useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

export function useViewportSelectionPublisher(editor: Editor | undefined, room: Room | undefined, active: boolean) {
  const bus = useMemo(() => (room ? createLiveKitBus(room) : null), [room]);
  const viewportSessionRef = useRef<string | null>(null);
  const viewportTokenRef = useRef<string | null>(null);

  // Reset cached viewport token when room changes
  useEffect(() => {
    viewportSessionRef.current = null;
    viewportTokenRef.current = null;
  }, [room?.name]);

  useEffect(() => {
    if (!active || !room?.name) return;
    let cancelled = false;
    const ensureToken = async () => {
      if (viewportTokenRef.current) return;
      const randomId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      const sessionId = viewportSessionRef.current ?? `viewport-${room.name}-${randomId}`;
      viewportSessionRef.current = sessionId;
      try {
        const params = new URLSearchParams({ sessionId, roomId: room.name });
        const res = await fetchWithSupabaseAuth(`/api/canvas-agent/token?${params.toString()}`);
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const token = typeof json?.token === 'string' ? json.token : undefined;
        if (cancelled || !token) return;
        viewportTokenRef.current = token;
        try {
          (window as any).__presentCanvasViewportSessionId = sessionId;
          (window as any).__presentCanvasViewportToken = token;
        } catch {}
      } catch {}
    };
    void ensureToken();
    return () => {
      cancelled = true;
    };
  }, [active, room?.name]);

  useEffect(() => {
    if (!editor || !room || !active || !bus) return;
    let raf: number | null = null;
    let lastSent = 0;
    let lastHttpSent = 0;
    let lastViewport: { x: number; y: number; w: number; h: number; z: number } | null = null;
    let lastSelection: string[] | null = null;

    const viewportChanged = (next: { x: number; y: number; w: number; h: number; z: number }) => {
      if (!lastViewport) return true;
      const dx = Math.abs(next.x - lastViewport.x);
      const dy = Math.abs(next.y - lastViewport.y);
      const dw = Math.abs(next.w - lastViewport.w);
      const dh = Math.abs(next.h - lastViewport.h);
      const dz = Math.abs(next.z - lastViewport.z);
      return dx > 2 || dy > 2 || dw > 2 || dh > 2 || dz > 0.01;
    };

    const selectionChanged = (next: string[]) => {
      const sortedNext = [...next].sort();
      if (!lastSelection) {
        lastSelection = sortedNext;
        return sortedNext.length > 0;
      }
      if (sortedNext.length !== lastSelection.length) {
        lastSelection = sortedNext;
        return true;
      }
      for (let i = 0; i < sortedNext.length; i += 1) {
        if (sortedNext[i] !== lastSelection[i]) {
          lastSelection = sortedNext;
          return true;
        }
      }
      lastSelection = sortedNext;
      return false;
    };

    const tick = () => {
      const now = Date.now();
      if (!editor || !room || room.state !== 'connected') {
        raf = window.requestAnimationFrame(tick);
        return;
      }
      if (now - lastSent >= 80) {
        lastSent = now;
        try {
          const cam = editor.getCamera();
          const bounds = editor.getViewportPageBounds();
          const selection = editor.getSelectedShapeIds();
          const viewportPayload = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, z: cam.z };
          const shouldSendViewport = viewportChanged(viewportPayload) || selectionChanged(selection);
          if (shouldSendViewport) {
            lastViewport = viewportPayload;
            bus.send('agent:viewport_selection', {
              type: 'agent:viewport_selection',
              viewport: viewportPayload,
              selection,
              ts: now,
            });
          }
          if (shouldSendViewport && now - lastHttpSent >= 300) {
            lastHttpSent = now;
            const agentToken = (window as any).__presentCanvasAgentToken as string | undefined;
            const agentSessionId = (window as any).__presentCanvasAgentSessionId as string | undefined;
            const fallbackSessionId = viewportSessionRef.current || (window as any).__presentCanvasViewportSessionId;
            const fallbackToken = viewportTokenRef.current || (window as any).__presentCanvasViewportToken;
            const sessionId = agentSessionId ?? fallbackSessionId;
            const token = agentToken ?? fallbackToken;
            if (!token || !sessionId) {
              raf = window.requestAnimationFrame(tick);
              return;
            }
            const payload = {
              roomId: room.name,
              sessionId,
              viewport: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
              selection,
              ts: now,
              token,
            };
            fetchWithSupabaseAuth('/api/canvas-agent/viewport', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
              keepalive: true,
            }).catch(() => {});
          }
        } catch {}
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => { if (raf) window.cancelAnimationFrame(raf); };
  }, [editor, room, active, bus]);
}
