"use client";

import { useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

export function useViewportSelectionPublisher(editor: Editor | undefined, room: Room | undefined, active: boolean) {
  const bus = useMemo(() => (room ? createLiveKitBus(room) : null), [room]);
  const lastSentSelectionRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (!editor || !room || !active || !bus) return;
    let raf: number | null = null;
    let lastSent = 0;
    let lastViewport: { x: number; y: number; w: number; h: number; z: number } | null = null;
    let lastSelection: string[] | null = lastSentSelectionRef.current;

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
      // Viewport / selection is "nice to have" context for agents. Keep it lightweight.
      if (now - lastSent >= 200) {
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
        } catch {}
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      lastSentSelectionRef.current = lastSelection;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [editor, room, active, bus]);
}
