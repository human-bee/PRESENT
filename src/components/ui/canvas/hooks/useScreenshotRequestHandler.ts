"use client";

import { useEffect } from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

export function useScreenshotRequestHandler(editor: Editor | undefined, room: Room | undefined) {
  useEffect(() => {
    if (!editor || !room) return;
    const bus = createLiveKitBus(room);
    const off = bus.on('agent:screenshot_request', async (message: any) => {
      try {
        if (!message || message.type !== 'agent:screenshot_request') return;
        const { sessionId, requestId, bounds, maxSize, token: requestToken, roomId: messageRoomId } = message;
        const viewBounds = editor.getViewportPageBounds();
        const target = bounds || { x: viewBounds.x, y: viewBounds.y, w: viewBounds.w, h: viewBounds.h };
        const size = maxSize || { w: 800, h: 800 };
        const image = await editor.toImage({ bounds: target, type: 'png', quality: 1, scale: 1, background: false, maxDimension: Math.max(size.w, size.h) } as any);
        const dataUrl = (image as any)?.url || (image as any);
        const width = (image as any)?.width || 0;
        const height = (image as any)?.height || 0;
        const bytes = typeof dataUrl === 'string' ? Math.ceil((dataUrl.length * 3) / 4) : 0;
        const viewport = editor.getViewportPageBounds();
        const selection = editor.getSelectedShapeIds();
        const docVersion = String((window as any).__present_tldraw_doc_version || 0);
        try {
          const fallbackToken = (window as any).__presentCanvasAgentToken as string | undefined;
          const token = typeof requestToken === 'string' ? requestToken : fallbackToken;
          const roomId = typeof messageRoomId === 'string' && messageRoomId ? messageRoomId : room?.name || '';
          await fetch('/api/canvas-agent/screenshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              requestId,
              roomId,
              token,
              image: { mime: 'image/png', dataUrl, bytes, width, height },
              bounds: { x: target.x, y: target.y, w: target.w, h: target.h },
              viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
              selection,
              docVersion,
            }),
          });
        } catch {}
      } catch {}
    });
    return () => { off?.(); };
  }, [editor, room]);
}
