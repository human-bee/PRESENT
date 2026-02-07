import { NextRequest, NextResponse } from 'next/server';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { isFastStewardReady } from '@/lib/agents/fast-steward-config';
import { runDebateScorecardSteward } from '@/lib/agents/debate-judge';
import { runDebateScorecardStewardFast } from '@/lib/agents/subagents/debate-steward-fast';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

export const runtime = 'nodejs';

let queue: AgentTaskQueue | null = null;
function getQueue() {
  if (!queue) queue = new AgentTaskQueue();
  return queue;
}
const QUEUE_DIRECT_FALLBACK_ENABLED = process.env.SCORECARD_QUEUE_DIRECT_FALLBACK === 'true';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { room, componentId, windowMs, summary, prompt, intent, topic, task, requestId, ...rest } =
      body && typeof body === 'object' ? body : {};

    if (typeof room !== 'string' || !room.trim()) {
      return NextResponse.json({ error: 'Missing or invalid room' }, { status: 400 });
    }

    if (typeof componentId !== 'string' || !componentId.trim()) {
      return NextResponse.json({ error: 'Missing or invalid componentId' }, { status: 400 });
    }

    const trimmedRoom = room.trim();
    const trimmedComponentId = componentId.trim();

    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(req);
      if (!requesterUserId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const canvasId = parseCanvasIdFromRoom(trimmedRoom);
      if (!canvasId) {
        return NextResponse.json({ error: 'invalid_room' }, { status: 400 });
      }
      try {
        const membership = await assertCanvasMember({ canvasId, requesterUserId });
        billingUserId = membership.ownerUserId;
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }
    const resolvedWindow =
      windowMs === undefined || windowMs === null ? undefined : Number(windowMs);
    if (resolvedWindow !== undefined && Number.isNaN(resolvedWindow)) {
      return NextResponse.json({ error: 'Invalid windowMs value' }, { status: 400 });
    }

    const normalizedSummary =
      typeof summary === 'string' && summary.trim().length > 0 ? summary.trim().slice(0, 240) : undefined;
    const normalizedPrompt =
      typeof prompt === 'string' && prompt.trim().length > 0 ? prompt.trim() : undefined;
    const normalizedIntent =
      typeof intent === 'string' && intent.trim().length > 0 ? intent.trim() : undefined;
    const normalizedTopic =
      typeof topic === 'string' && topic.trim().length > 0 ? topic.trim() : undefined;
    const normalizedTaskCandidate =
      typeof task === 'string' && task.trim().length > 0
        ? task.trim()
        : normalizedIntent && normalizedIntent.startsWith('scorecard.')
          ? normalizedIntent
          : 'scorecard.run';
    const normalizedTask = normalizedTaskCandidate.startsWith('scorecard.') ? normalizedTaskCandidate : 'scorecard.run';

    console.debug('[runScorecard][debug] POST received', {
      room: trimmedRoom,
      componentId: trimmedComponentId,
      task: normalizedTask,
      windowMs: resolvedWindow,
      summary: normalizedSummary,
      intent: normalizedIntent,
      topic: normalizedTopic,
    });

    const normalizedParams = {
      ...(rest && typeof rest === 'object' ? rest : {}),
      room: trimmedRoom,
      componentId: trimmedComponentId,
      windowMs: resolvedWindow,
      summary: normalizedSummary,
      prompt: normalizedPrompt,
      intent: normalizedIntent,
      topic: normalizedTopic,
      ...(billingUserId ? { billingUserId } : {}),
    } as const;

    try {
      // Lazily instantiate so `next build` doesn't require Supabase env vars.
      const enqueueResult = await getQueue().enqueueTask({
        room: trimmedRoom,
        task: normalizedTask,
        params: normalizedParams as any,
        requestId: typeof requestId === 'string' && requestId.trim() ? requestId.trim() : undefined,
        resourceKeys: [`room:${trimmedRoom}`, `scorecard:${trimmedComponentId}`],
      });
      return NextResponse.json({ status: 'queued', task: enqueueResult }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Steward][runScorecard] queue enqueue failed', { message });
      if (!QUEUE_DIRECT_FALLBACK_ENABLED) {
        return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 });
      }

      const cerebrasKey =
        BYOK_ENABLED && billingUserId
          ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
          : null;
      const useFast = normalizedTask !== 'scorecard.fact_check' && isFastStewardReady(cerebrasKey ?? undefined);
      try {
        if (useFast) {
          await runDebateScorecardStewardFast({
            room: trimmedRoom,
            componentId: trimmedComponentId,
            intent: normalizedIntent ?? normalizedTask,
            summary: normalizedSummary,
            prompt: normalizedPrompt,
            topic: normalizedTopic,
            ...(billingUserId ? { billingUserId } : {}),
          });
        } else {
          await runDebateScorecardSteward({
            room: trimmedRoom,
            componentId: trimmedComponentId,
            windowMs: resolvedWindow,
            intent: normalizedIntent ?? normalizedTask,
            summary: normalizedSummary,
            prompt: normalizedPrompt,
            topic: normalizedTopic,
            ...(billingUserId ? { billingUserId } : {}),
          });
        }
        return NextResponse.json({ status: 'executed_fallback' }, { status: 202 });
      } catch (fallbackError) {
        console.error('[Steward][runScorecard] fallback execution failed', fallbackError);
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    console.error('Invalid request to steward/runScorecard', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
