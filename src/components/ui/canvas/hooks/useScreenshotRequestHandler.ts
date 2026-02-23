"use client";

import { useEffect } from 'react';
import { Box, type Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { resolveEdgeIngressUrl } from '@/lib/edge-ingress';

type ScreenshotRequest = {
  type: 'agent:screenshot_request';
  sessionId: string;
  requestId: string;
  bounds?: { x: number; y: number; w: number; h: number };
  maxSize?: { w: number; h: number };
  token?: string;
  roomId?: string;
  requesterParticipantId?: string;
};

type BurstState = {
  firstRequestId: string;
  firstSceneHash: string;
  latestMessage?: ScreenshotRequest;
  latestSceneHash?: string;
  timer?: ReturnType<typeof setTimeout>;
};

const resolveCoalesceWindowMs = () =>
  Math.max(75, Number(process.env.NEXT_PUBLIC_CANVAS_SCREENSHOT_COALESCE_MS ?? 250));

export function useScreenshotRequestHandler(
  editor: Editor | undefined,
  room: Room | undefined,
  options?: { isHost?: boolean; hostId?: string | null },
) {
  useEffect(() => {
    if (!editor || !room) return;

    const bus = createLiveKitBus(room);
    const isDev = process.env.NODE_ENV !== 'production';
    const coalesceWindowMs = resolveCoalesceWindowMs();
    const burstStateByKey = new Map<string, BurstState>();
    const uploadedRequestAt = new Map<string, number>();
    const requestUploadDedupeTtlMs = 5 * 60_000;

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

    const toBurstKey = (sessionId: string, rawTarget: { x: number; y: number; w: number; h: number }) =>
      `${sessionId}:${Math.round(rawTarget.x)}:${Math.round(rawTarget.y)}:${Math.round(rawTarget.w)}:${Math.round(rawTarget.h)}`;

    const captureAndUpload = async (message: ScreenshotRequest, sceneHash: string, attempt = 0) => {
      const {
        sessionId,
        requestId,
        bounds,
        maxSize,
        token: requestToken,
        roomId: messageRoomId,
        requesterParticipantId,
      } = message;
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

      const targetBox = Box.From(rawTarget);
      const size = maxSize || { w: 800, h: 800 };
      const longestTargetSide = Math.max(targetBox?.w ?? 0, targetBox?.h ?? 0) || 1;
      const desiredLongestSide = Math.max(size?.w ?? 0, size?.h ?? 0, 1);
      const exportScale = Math.min(4, Math.max(0.25, desiredLongestSide / longestTargetSide));
      const shapes = editor.getCurrentPageShapesSorted().filter((shape: any) => {
        const shapeBounds = editor.getShapeMaskedPageBounds(shape);
        if (!shapeBounds) return false;
        const intersectsHorizontally =
          shapeBounds.x + shapeBounds.w >= rawTarget.x && shapeBounds.x <= rawTarget.x + rawTarget.w;
        const intersectsVertically =
          shapeBounds.y + shapeBounds.h >= rawTarget.y && shapeBounds.y <= rawTarget.y + rawTarget.h;
        return intersectsHorizontally && intersectsVertically;
      });

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
        const image = await editor.toImage(shapes, {
          format: 'png',
          background: false,
          bounds: targetBox,
          padding: 0,
          scale: exportScale,
        });
        const blob: Blob | undefined = (image as any)?.blob;
        if (blob) {
          dataUrl = await blobToDataUrl(blob);
        }
        width = (image as any)?.width || 0;
        height = (image as any)?.height || 0;
      }

      const bytes = typeof dataUrl === 'string' ? Math.ceil((dataUrl.length * 3) / 4) : 0;
      const viewport = editor.getViewportPageBounds();
      const selection = editor.getSelectedShapeIds();
      const docVersion = String((window as any).__present_tldraw_doc_version || 0);

      const fallbackToken = (window as any).__presentCanvasAgentToken as string | undefined;
      const token = typeof requestToken === 'string' ? requestToken : fallbackToken;
      const roomId = typeof messageRoomId === 'string' && messageRoomId ? messageRoomId : room?.name || '';
      const uploaderParticipantId =
        typeof room?.localParticipant?.identity === 'string' && room.localParticipant.identity.trim().length > 0
          ? room.localParticipant.identity.trim()
          : undefined;
      const response = await fetch(resolveEdgeIngressUrl('/api/canvas-agent/screenshot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          requestId,
          roomId,
          token,
          ...(typeof requesterParticipantId === 'string' && requesterParticipantId.trim().length > 0
            ? { requesterParticipantId: requesterParticipantId.trim() }
            : {}),
          ...(uploaderParticipantId ? { uploaderParticipantId } : {}),
          image: { mime: 'image/png', dataUrl, bytes, width, height },
          bounds: { x: rawTarget.x, y: rawTarget.y, w: rawTarget.w, h: rawTarget.h },
          viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
          selection,
          docVersion,
        }),
      });
      if (response.status === 429 && attempt < 1) {
        const retryAfterSec = Number(response.headers.get('retry-after') || '1');
        const retryDelayMs = Math.max(250, Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 1000);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return captureAndUpload(message, sceneHash, attempt + 1);
      }
      if (!response.ok) {
        throw new Error(`Screenshot upload failed: ${response.status}`);
      }

      uploadedRequestAt.set(requestKey, Date.now());
      if (uploadedRequestAt.size > 2500) {
        const cutoff = Date.now() - requestUploadDedupeTtlMs;
        for (const [key, timestamp] of uploadedRequestAt) {
          if (timestamp < cutoff) uploadedRequestAt.delete(key);
        }
      }
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

    const off = bus.on('agent:screenshot_request', async (message: unknown) => {
      try {
        if (!message || typeof message !== 'object') return;
        const request = message as ScreenshotRequest;
        if (request.type !== 'agent:screenshot_request') return;

        const sessionId = String(request.sessionId || '').trim();
        const requestId = String(request.requestId || '').trim();
        if (!sessionId || !requestId) return;
        const localParticipantId =
          typeof room.localParticipant?.identity === 'string' ? room.localParticipant.identity.trim() : '';
        const requesterParticipantId =
          typeof request.requesterParticipantId === 'string' && request.requesterParticipantId.trim().length > 0
            ? request.requesterParticipantId.trim()
            : '';
        const requesterIsLocal = Boolean(localParticipantId && requesterParticipantId && localParticipantId === requesterParticipantId);
        const requesterIsPresent =
          Boolean(requesterParticipantId) &&
          (requesterIsLocal ||
            Array.from(room.remoteParticipants.values()).some(
              (participant) => participant.identity === requesterParticipantId,
            ));
        const hostFallbackEligible =
          Boolean(options?.isHost) && (!requesterParticipantId || !requesterIsPresent);
        const shouldRespond = requesterIsLocal || hostFallbackEligible;
        if (!shouldRespond) {
          if (isDev) {
            console.log('[ScreenshotHandler] skipping request; not requester/host fallback', {
              sessionId,
              requestId,
              requesterParticipantId,
              localParticipantId,
              hostId: options?.hostId ?? null,
            });
          }
          return;
        }

        const viewport = editor.getViewportPageBounds();
        const rawTarget =
          request.bounds || { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h };
        const selection = editor.getSelectedShapeIds();
        const docVersion = String((window as any).__present_tldraw_doc_version || 0);
        const shapeCount = editor.getCurrentPageShapesSorted().length;
        const sceneHash = computeSceneHash(sessionId, rawTarget, viewport, selection, docVersion, shapeCount);
        const burstKey = toBurstKey(sessionId, rawTarget);

        const existingBurst = burstStateByKey.get(burstKey);
        if (!existingBurst) {
          const burst: BurstState = { firstRequestId: requestId, firstSceneHash: sceneHash };
          burstStateByKey.set(burstKey, burst);
          await captureAndUpload(request, sceneHash).catch((error) => {
            if (isDev) console.warn('[ScreenshotHandler] upload failed', error);
          });
          burst.timer = setTimeout(() => {
            const snapshot = burstStateByKey.get(burstKey);
            if (!snapshot) return;
            const trailingMessage = snapshot.latestMessage;
            const trailingHash = snapshot.latestSceneHash;
            burstStateByKey.delete(burstKey);
            if (
              trailingMessage &&
              trailingHash &&
              (trailingHash !== snapshot.firstSceneHash ||
                trailingMessage.requestId !== snapshot.firstRequestId)
            ) {
              void captureAndUpload(trailingMessage, trailingHash).catch((error) => {
                if (isDev) console.warn('[ScreenshotHandler] trailing upload failed', error);
              });
            }
          }, coalesceWindowMs);
          return;
        }

        existingBurst.latestMessage = request;
        existingBurst.latestSceneHash = sceneHash;
      } catch (error) {
        if (isDev) console.warn('[ScreenshotHandler] request handling failed', error);
      }
    });

    return () => {
      off?.();
      burstStateByKey.forEach((state) => {
        if (state.timer) clearTimeout(state.timer);
      });
      burstStateByKey.clear();
    };
  }, [editor, room, options?.isHost, options?.hostId]);
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
