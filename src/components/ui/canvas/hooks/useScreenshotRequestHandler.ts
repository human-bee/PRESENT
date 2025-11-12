"use client";

import { useEffect } from 'react';
import { Box, type Editor } from '@tldraw/tldraw';
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
        const isDev = process.env.NODE_ENV !== 'production';
        if (isDev) {
          console.log('[ScreenshotHandler] request received', {
            sessionId,
            requestId,
            bounds,
            maxSize,
            roomId: messageRoomId,
          });
        }
        const viewBounds = editor.getViewportPageBounds();
        const rawTarget = bounds || { x: viewBounds.x, y: viewBounds.y, w: viewBounds.w, h: viewBounds.h };
        const targetBox = Box.From(rawTarget);
        const size = maxSize || { w: 800, h: 800 };
        const longestTargetSide = Math.max(targetBox?.w ?? 0, targetBox?.h ?? 0) || 1;
        const desiredLongestSide = Math.max(size?.w ?? 0, size?.h ?? 0, 1);
        const exportScale = Math.min(4, Math.max(0.25, desiredLongestSide / longestTargetSide));
        const shapes = editor.getCurrentPageShapesSorted().filter((shape: any) => {
          const shapeBounds = editor.getShapeMaskedPageBounds(shape);
          if (!shapeBounds) return false;
          const intersectsHorizontally = shapeBounds.x + shapeBounds.w >= rawTarget.x && shapeBounds.x <= rawTarget.x + rawTarget.w;
          const intersectsVertically = shapeBounds.y + shapeBounds.h >= rawTarget.y && shapeBounds.y <= rawTarget.y + rawTarget.h;
          return intersectsHorizontally && intersectsVertically;
        });
        if (isDev) {
          console.log('[ScreenshotHandler] shapes in bounds', shapes.length, { targetProto: targetBox?.constructor?.name });
        }
        let dataUrl: string | undefined;
        let width = 0;
        let height = 0;
        const startedAt = Date.now();
        if (shapes.length === 0) {
          const canvas = document.createElement('canvas');
          width = Math.max(1, Math.round(size.w));
          height = Math.max(1, Math.round(size.h));
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#0b0b0b';
            ctx.fillRect(0, 0, width, height);
          }
          dataUrl = canvas.toDataURL('image/png');
        } else {
          const image = await editor
            .toImage(shapes, {
              format: 'png',
              background: false,
              bounds: targetBox,
              padding: 0,
              scale: exportScale,
            })
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              console.warn('[ScreenshotHandler] toImage failed', detail);
              throw error;
            });
          const blob: Blob | undefined = (image as any)?.blob;
          if (blob) {
            dataUrl = await blobToDataUrl(blob);
          }
          width = (image as any)?.width || 0;
          height = (image as any)?.height || 0;
        }
        const bytes = typeof dataUrl === 'string' ? Math.ceil((dataUrl.length * 3) / 4) : 0;
        if (isDev) {
          console.log('[ScreenshotHandler] capture duration ms', Date.now() - startedAt);
        }
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
              bounds: { x: rawTarget.x, y: rawTarget.y, w: rawTarget.w, h: rawTarget.h },
              viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
              selection,
              docVersion,
            }),
          })
            .then(() => {
              if (process.env.NODE_ENV !== 'production') {
                console.log('[ScreenshotHandler] uploaded', { sessionId, requestId, bytes });
              }
            })
            .catch((error) => {
              console.warn('[ScreenshotHandler] upload failed', error);
            });
        } catch (error) {
          console.warn('[ScreenshotHandler] unable to capture screenshot', error);
        }
      } catch {}
    });
    return () => { off?.(); };
  }, [editor, room]);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read screenshot blob'));
    };
    reader.readAsDataURL(blob);
  });
}
