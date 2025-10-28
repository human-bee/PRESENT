import { getCanvasShapeSummary, getTranscriptWindow } from '@/lib/agents/shared/supabase-context';
import { OffsetManager, serializeBounds } from './offset';

export type Viewport = { x: number; y: number; w: number; h: number };

export type PromptScreenshot = {
  image?: { dataUrl: string; mime: string; bytes: number; width?: number; height?: number };
  viewport?: Viewport;
  selection?: string[];
  docVersion?: string;
  bounds?: Viewport;
  requestId?: string;
  receivedAt?: number;
};

export type BuildPromptOptions = {
  windowMs?: number;
  viewport?: Viewport;
  selection?: string[];
  sessionId?: string;
  screenshot?: PromptScreenshot;
  offset?: OffsetManager;
};

export async function buildPromptParts(room: string, options: BuildPromptOptions) {
  const [canvas, transcript] = await Promise.all([
    getCanvasShapeSummary(room),
    getTranscriptWindow(room, Math.max(1000, options.windowMs || 60000)),
  ]);

  const rawViewport = options.screenshot?.viewport ?? options.viewport;
  const effectiveViewport = rawViewport && options.offset ? serializeBounds(rawViewport, options.offset) : rawViewport;
  const rawSelection = options.screenshot?.selection ?? options.selection ?? [];
  const selection = Array.isArray(rawSelection) ? [...rawSelection] : [];

  const parts: Record<string, unknown> = {
    room,
    shapes: canvas.shapes.slice(0, 300),
    viewport: effectiveViewport,
    selection,
    transcript: Array.isArray(transcript?.transcript) ? transcript.transcript.slice(-50) : [],
    docVersion: options.screenshot?.docVersion ?? String(canvas.version || 0),
  };

  if (effectiveViewport) {
    parts.viewportCenter = {
      x: effectiveViewport.x + effectiveViewport.w / 2,
      y: effectiveViewport.y + effectiveViewport.h / 2,
    };
  }

  if (options.screenshot?.image?.dataUrl) {
    parts.screenshot = {
      dataUrl: options.screenshot.image.dataUrl,
      mime: options.screenshot.image.mime,
      bytes: options.screenshot.image.bytes,
      width: options.screenshot.image.width,
      height: options.screenshot.image.height,
      bounds: options.screenshot.bounds ?? effectiveViewport,
      receivedAt: options.screenshot.receivedAt,
      requestId: options.screenshot.requestId,
    };
  }

  // Screenshot embedding is orchestrated by the runner and passed in through options.screenshot.

  return parts;
}
