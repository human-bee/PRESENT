"use client";

import { useEffect } from 'react';
import { Box, type Editor } from '@tldraw/tldraw';
import { RoomEvent, type Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { resolveEdgeIngressUrl } from '@/lib/edge-ingress';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

type ScreenshotRequest = {
  type: 'agent:screenshot_request';
  sessionId: string;
  requestId: string;
  bounds?: { x: number; y: number; w: number; h: number };
  maxSize?: { w: number; h: number };
  token?: string;
  roomId?: string;
};

const SCREENSHOT_REQUEST_DEDUPE_TTL_MS = 5 * 60_000;
const SCREENSHOT_EXPORT_TIMEOUT_MS = Math.max(
  500,
  Number(process.env.NEXT_PUBLIC_CANVAS_SCREENSHOT_EXPORT_TIMEOUT_MS ?? 1500),
);
const SCREENSHOT_UPLOAD_TIMEOUT_MS = Math.max(
  800,
  Number(process.env.NEXT_PUBLIC_CANVAS_SCREENSHOT_UPLOAD_TIMEOUT_MS ?? 10000),
);

const decodeDataPacket = (data: Uint8Array): unknown => {
  try {
    if (typeof TextDecoder !== 'undefined') {
      return JSON.parse(new TextDecoder().decode(data));
    }
    if (typeof Buffer !== 'undefined') {
      return JSON.parse(Buffer.from(data).toString('utf-8'));
    }
  } catch {
    return null;
  }
  return null;
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.then(resolve).catch(reject);
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

export function useScreenshotRequestHandler(editor: Editor | undefined, room: Room | undefined) {
  useEffect(() => {
    if (!editor || !room) return;

    const bus = createLiveKitBus(room);
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      console.log('[ScreenshotHandler] mounted', { room: room.name || null });
    }
    const uploadedRequestAt = new Map<string, number>();
    const handledRequestAt = new Map<string, number>();
    const requestUploadDedupeTtlMs = 5 * 60_000;
    const handledRequestDedupeTtlMs = SCREENSHOT_REQUEST_DEDUPE_TTL_MS;

    const pruneRequestMap = (store: Map<string, number>, ttlMs: number, maxSize: number) => {
      if (store.size <= maxSize) return;
      const cutoff = Date.now() - ttlMs;
      for (const [key, timestamp] of store) {
        if (timestamp < cutoff) store.delete(key);
      }
    };

    const computeSceneHash = (
      sessionId: string,
      rawTarget: { x: number; y: number; w: number; h: number },
      viewport: { x: number; y: number; w: number; h: number },
      selection: string[],
      docVersion: string,
      shapeCount: number,
    ) =>
      [
        sessionId,
        docVersion,
        `${Math.round(rawTarget.x)}:${Math.round(rawTarget.y)}:${Math.round(rawTarget.w)}:${Math.round(rawTarget.h)}`,
        `${Math.round(viewport.x)}:${Math.round(viewport.y)}:${Math.round(viewport.w)}:${Math.round(viewport.h)}`,
        selection.slice().sort().join(','),
        shapeCount,
      ].join('|');

    const captureAndUpload = async (message: ScreenshotRequest, sceneHash: string, attempt = 0) => {
      const { sessionId, requestId, bounds, maxSize, token: requestToken, roomId: messageRoomId } = message;
      const requestKey = `${sessionId}:${requestId}`;
      const uploadedAt = uploadedRequestAt.get(requestKey);
      if (typeof uploadedAt === 'number' && Date.now() - uploadedAt < requestUploadDedupeTtlMs) {
        if (isDev) {
          console.log('[ScreenshotHandler] skipped duplicate request', { sessionId, requestId });
        }
        return;
      }
      const viewBounds = editor.getViewportPageBounds();
      const rawTarget = bounds || { x: viewBounds.x, y: viewBounds.y, w: viewBounds.w, h: viewBounds.h };
      if (isDev) {
        console.log('[ScreenshotHandler] capture start', {
          sessionId,
          requestId,
          attempt,
          room: room.name || null,
          roomId: messageRoomId ?? null,
          target: rawTarget,
        });
      }

      const targetBox = Box.From(rawTarget);
      const size = maxSize || { w: 800, h: 800 };
      const longestTargetSide = Math.max(targetBox?.w ?? 0, targetBox?.h ?? 0) || 1;
      const desiredLongestSide = Math.max(size?.w ?? 0, size?.h ?? 0, 1);
      const exportScale = Math.min(4, Math.max(0.25, desiredLongestSide / longestTargetSide));
      const pageShapes = editor.getCurrentPageShapesSorted();
      const shapes = pageShapes.filter((shape: any) => {
        try {
          const shapeBounds = editor.getShapeMaskedPageBounds(shape);
          if (!shapeBounds) return false;
          const intersectsHorizontally =
            shapeBounds.x + shapeBounds.w >= rawTarget.x && shapeBounds.x <= rawTarget.x + rawTarget.w;
          const intersectsVertically =
            shapeBounds.y + shapeBounds.h >= rawTarget.y && shapeBounds.y <= rawTarget.y + rawTarget.h;
          return intersectsHorizontally && intersectsVertically;
        } catch {
          // Keep rendering resilient for custom/stateful shapes whose bounds
          // can throw during transitions.
          return true;
        }
      });
      const exportShapes = shapes.length > 0 ? shapes : pageShapes;

      let dataUrl: string | undefined;
      let width = 0;
      let height = 0;
      const startedAt = Date.now();

      try {
        if (exportShapes.length === 0) {
          width = Math.max(1, Math.round(size.w));
          height = Math.max(1, Math.round(size.h));
          dataUrl = createBlankScreenshotDataUrl(width, height);
        } else {
          const image = await withTimeout(
            editor.toImage(exportShapes, {
              format: 'png',
              background: false,
              bounds: targetBox,
              padding: 0,
              scale: exportScale,
            }),
            SCREENSHOT_EXPORT_TIMEOUT_MS,
            'editor.toImage',
          );
          const blob: Blob | undefined = (image as any)?.blob;
          if (blob) {
            dataUrl = await blobToDataUrl(blob);
          }
          width = (image as any)?.width || 0;
          height = (image as any)?.height || 0;
        }
      } catch (error) {
        if (isDev) {
          console.warn('[ScreenshotHandler] toImage failed; using blank fallback', error);
        }
        width = Math.max(1, Math.round(size.w));
        height = Math.max(1, Math.round(size.h));
        dataUrl = createBlankScreenshotDataUrl(width, height);
      }

      if (!dataUrl) {
        width = Math.max(width, 1);
        height = Math.max(height, 1);
        dataUrl = createBlankScreenshotDataUrl(width, height);
      }

      const bytes = typeof dataUrl === 'string' ? Math.ceil((dataUrl.length * 3) / 4) : 0;
      const viewport = editor.getViewportPageBounds();
      const selection = editor.getSelectedShapeIds();
      const docVersion = String((window as any).__present_tldraw_doc_version || 0);

      const fallbackToken = (window as any).__presentCanvasAgentToken as string | undefined;
      const token = typeof requestToken === 'string' ? requestToken : fallbackToken;
      const roomId = typeof messageRoomId === 'string' && messageRoomId ? messageRoomId : room?.name || '';
      if (isDev) {
        console.log('[ScreenshotHandler] upload start', {
          sessionId,
          requestId,
          roomId,
          tokenPresent: Boolean(token),
          bytes,
          width,
          height,
        });
      }
      const uploadController = new AbortController();
      const uploadTimeout = setTimeout(() => uploadController.abort(), SCREENSHOT_UPLOAD_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchWithSupabaseAuth(resolveEdgeIngressUrl('/api/canvas-agent/screenshot'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: uploadController.signal,
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
        });
      } finally {
        clearTimeout(uploadTimeout);
      }
      if (response.status === 429 && attempt < 1) {
        const retryAfterSec = Number(response.headers.get('retry-after') || '1');
        const retryDelayMs = Math.max(250, Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 1000);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return captureAndUpload(message, sceneHash, attempt + 1);
      }
      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        throw new Error(`Screenshot upload failed: ${response.status}${responseText ? ` ${responseText}` : ''}`);
      }

      uploadedRequestAt.set(requestKey, Date.now());
      pruneRequestMap(uploadedRequestAt, requestUploadDedupeTtlMs, 2500);
      if (isDev) {
        console.log('[ScreenshotHandler] uploaded', {
          sessionId,
          requestId,
          sceneHash,
          bytes,
          durationMs: Date.now() - startedAt,
        });
      }
    };

    const handleScreenshotRequest = async (message: unknown) => {
      try {
        if (!message || typeof message !== 'object') return;
        const request = message as ScreenshotRequest;
        if (request.type !== 'agent:screenshot_request') return;

        const sessionId = String(request.sessionId || '').trim();
        const requestId = String(request.requestId || '').trim();
        if (!sessionId || !requestId) return;
        const requestKey = `${sessionId}:${requestId}`;
        const handledAt = handledRequestAt.get(requestKey);
        if (typeof handledAt === 'number' && Date.now() - handledAt < handledRequestDedupeTtlMs) {
          return;
        }
        handledRequestAt.set(requestKey, Date.now());
        pruneRequestMap(handledRequestAt, handledRequestDedupeTtlMs, 2500);
        if (isDev) {
          console.log('[ScreenshotHandler] request received', {
            topic: 'agent:screenshot_request',
            sessionId,
            requestId,
            room: room.name || null,
          });
        }

        const viewport = editor.getViewportPageBounds();
        const rawTarget =
          request.bounds || { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h };
        const selection = editor.getSelectedShapeIds();
        const docVersion = String((window as any).__present_tldraw_doc_version || 0);
        const shapeCount = editor.getCurrentPageShapesSorted().length;
        const sceneHash = computeSceneHash(sessionId, rawTarget, viewport, selection, docVersion, shapeCount);
        void captureAndUpload(request, sceneHash).catch((error) => {
          if (isDev) console.warn('[ScreenshotHandler] upload failed', error);
        });
      } catch (error) {
        if (isDev) console.warn('[ScreenshotHandler] request handling failed', error);
      }
    };

    const off = bus.on('agent:screenshot_request', (message: unknown) => {
      void handleScreenshotRequest(message);
    });

    const onRawData = (
      data: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topicName?: unknown,
    ) => {
      const decoded = decodeDataPacket(data);
      if (!decoded || typeof decoded !== 'object') return;
      const decodedType =
        typeof (decoded as { type?: unknown }).type === 'string'
          ? ((decoded as { type: string }).type as string)
          : '';
      const isTopicMatch = topicName === 'agent:screenshot_request';
      const isTypeMatch = decodedType === 'agent:screenshot_request';
      if (!isTopicMatch && !isTypeMatch) return;
      if (isDev) {
        console.log('[ScreenshotHandler] raw packet matched', {
          topicName: typeof topicName === 'string' ? topicName : null,
          decodedType,
        });
      }
      void handleScreenshotRequest(decoded);
    };
    room.on(RoomEvent.DataReceived, onRawData);

    return () => {
      off?.();
      room.off(RoomEvent.DataReceived, onRawData);
      handledRequestAt.clear();
      uploadedRequestAt.clear();
      if (isDev) {
        console.log('[ScreenshotHandler] unmounted', { room: room.name || null });
      }
    };
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

function createBlankScreenshotDataUrl(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL('image/png');
}
