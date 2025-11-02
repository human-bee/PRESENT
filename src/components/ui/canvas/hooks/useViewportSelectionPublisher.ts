"use client";

import { useEffect } from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

export function useViewportSelectionPublisher(editor: Editor | undefined, room: Room | undefined, active: boolean) {
  useEffect(() => {
    if (!editor || !room || !active) return;
    const bus = createLiveKitBus(room);
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
            const token = (window as any).__presentCanvasAgentToken as string | undefined;
            const agentSessionId = (window as any).__presentCanvasAgentSessionId as string | undefined;
            if (!token || !agentSessionId) {
              raf = window.requestAnimationFrame(tick);
              return;
            }
            const payload = {
              roomId: room.name,
              sessionId: agentSessionId,
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
  }, [editor, room, active]);
}


