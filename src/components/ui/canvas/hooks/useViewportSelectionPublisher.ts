"use client";

import { useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

export function useViewportSelectionPublisher(editor: Editor | undefined, room: Room | undefined, active: boolean) {
  const bus = useMemo(() => (room ? createLiveKitBus(room) : null), [room]);
  const clientAgentEnabled =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true';
  const viewportSessionRef = useRef<string | null>(null);
  const viewportTokenRef = useRef<string | null>(null);

  // Reset cached viewport token when room changes
  useEffect(() => {
    viewportSessionRef.current = null;
    viewportTokenRef.current = null;
  }, [room?.name]);

  useEffect(() => {
    if (!active || !room?.name || !clientAgentEnabled) return;
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
        const res = await fetch(`/api/canvas-agent/token?${params.toString()}`);
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
    if (!editor || !room || !active || !bus || !clientAgentEnabled) return;
    let raf: number | null = null;
    let lastSent = 0;
    let lastHttpSent = 0;

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
          bus.send('agent:viewport_selection', {
            type: 'agent:viewport_selection',
            viewport: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, z: cam.z },
            selection,
            ts: now,
          });
          if (now - lastHttpSent >= 300) {
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
            fetch('/api/canvas-agent/viewport', {
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
