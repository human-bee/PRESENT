import { recordModelIoEvent } from '@/lib/agents/shared/replay-telemetry';
import type { FairyIntent } from './intent';
import type { JevRouteAttempt } from './jev-router';

const statusForAttempt = (attempt: JevRouteAttempt) => {
  if (attempt.outcome === 'accepted') return 'completed';
  if (attempt.outcome === 'deferred') return 'fallback';
  return 'skipped';
};

export function recordJevRouterAttempt(
  intent: FairyIntent,
  attempt: JevRouteAttempt,
  sequence: number,
): void {
  try {
    recordModelIoEvent({
      source: 'fairy_router',
      eventType: 'model_call',
      status: statusForAttempt(attempt),
      sequence,
      sessionId: `fairy-router-${intent.room}`,
      room: intent.room,
      requestId: intent.id,
      traceId: intent.id,
      intentId: intent.id,
      provider: 'typesafe',
      model: attempt.model,
      providerSource: 'runtime_selected',
      providerPath: 'jev_canvas_gate',
      latencyMs: attempt.durationMs,
      metadata: {
        outcome: attempt.outcome,
        reason: attempt.reason,
        choice: attempt.choice ?? null,
        confidence: attempt.confidence ?? null,
        probabilities: attempt.probabilities ?? null,
      },
    });
  } catch {
    // Replay telemetry must never interrupt routing or its existing fallback.
  }
}
