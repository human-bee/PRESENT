import { getCanvasShapeSummary, getTranscriptWindow } from '@/lib/agents/shared/supabase-context';
import { applyTokenBudget } from './context-utils/budget';
import { shapesInViewport, toBlurryShape, type ShapeLike } from './context-utils/geometry';
import { peripheralClusters } from './context-utils/peripheral';
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

  const shapes = Array.isArray(canvas.shapes) ? canvas.shapes : [];
  const transcriptEntries = Array.isArray(transcript?.transcript)
    ? transcript.transcript.filter((entry) => entry && typeof entry.text === 'string').slice(-50)
    : [];

  const blurryCandidates = shapesInViewport(shapes as ShapeLike[], effectiveViewport, 300).map(toBlurryShape);
  const peripheral = peripheralClusters(shapes as ShapeLike[], effectiveViewport, 320, 24);
  const transcriptTokens = transcriptEntries.reduce((sum, entry) => {
    const text = typeof entry.text === 'string' ? entry.text : '';
    return sum + Math.ceil(text.length / 4) + 4;
  }, 0);
  const maxTokens = Number.parseInt(process.env.CANVAS_AGENT_PROMPT_BUDGET || '8000', 10);
  const budgeted = applyTokenBudget(
    {
      transcript: transcriptEntries,
      blurry: blurryCandidates,
      clusters: peripheral,
    },
    {
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 8000,
      transcriptTokens,
      blurryCount: blurryCandidates.length,
      clusterCount: peripheral.length,
    },
  );

  const promptBudget = {
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 8000,
    transcriptTokens,
    blurryCount: budgeted.blurry.length,
    peripheralCount: budgeted.clusters.length,
  };

  const parts: Record<string, unknown> = {
    room,
    shapes: shapes.slice(0, 300),
    viewport: effectiveViewport,
    selection,
    transcript: budgeted.transcript,
    docVersion: options.screenshot?.docVersion ?? String(canvas.version || 0),
    blurryShapes: budgeted.blurry,
    peripheralClusters: budgeted.clusters,
    recentActions: Array.isArray((canvas as any).recentActions)
      ? (canvas as any).recentActions.slice(-8)
      : [],
    promptBudget,
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
