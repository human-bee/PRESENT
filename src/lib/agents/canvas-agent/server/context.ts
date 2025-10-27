import { getCanvasShapeSummary, getTranscriptWindow } from '@/lib/agents/shared/supabase-context';

export type Viewport = { x: number; y: number; w: number; h: number };

export async function buildPromptParts(room: string, options: { windowMs?: number; viewport?: Viewport; selection?: string[]; sessionId?: string }) {
  const [canvas, transcript] = await Promise.all([
    getCanvasShapeSummary(room),
    getTranscriptWindow(room, Math.max(1000, options.windowMs || 60000)),
  ]);

  const parts: Record<string, unknown> = {
    room,
    shapes: canvas.shapes.slice(0, 300),
    viewport: options.viewport,
    selection: options.selection || [],
    transcript: Array.isArray(transcript?.transcript) ? transcript.transcript.slice(-50) : [],
    docVersion: String(canvas.version || 0),
  };

  // Screenshot embedding is orchestrated by the runner (server-side) and not here.

  return parts;
}



