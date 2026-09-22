import type { Activity } from '../../shared/activity';
import type { verifyResolution } from './interpret-conversation';
import type { MeetingCoordinator } from './meeting';
import { trustedUtterance } from './speech-provenance';
import { activityEvent } from './activity-mutations';
export async function resolveSpoken(
  room: string,
  a: Activity,
  id: string,
  signal: AbortSignal,
  update: (fn: (a: Activity) => void) => void,
  verify: typeof verifyResolution,
  meetings: MeetingCoordinator,
) {
  const suggestion = a.resolutionSuggestions.find((s) => s.id === id),
    u = a.utterances.find((u) => u.id === suggestion?.source.utteranceId);
  if (!suggestion || !u) return;
  if (!trustedUtterance(room, a, u)) {
    update((next) => {
      const target = next.resolutionSuggestions.find((x) => x.id === id);
      if (target) {
        target.status = 'review';
        target.reason = 'The original speaker provenance could not be verified.';
      }
    });
    return;
  }
  update((next) => {
    const target = next.resolutionSuggestions.find((x) => x.id === id);
    if (target) target.status = 'checking';
  });
  const verdict = await verify(a, u, suggestion.blockerId, signal);
  signal.throwIfAborted();
  let retracted = false;
  update((next) => {
    const target = next.resolutionSuggestions.find((x) => x.id === id);
    if (!target) return;
    const latest = next.utterances.filter((x) => x.speakerId === u.speakerId).at(-1);
    if (latest?.id !== u.id || !trustedUtterance(room, next, latest)) {
      target.status = 'stale';
      target.reason = 'A newer owner statement arrived before confirmation.';
      return;
    }
    const expected = suggestion.intent === 'completed' ? 'confirm' : 'retract';
    if (
      verdict.blockerId !== target.blockerId ||
      verdict.decision !== expected ||
      !u.text.includes(verdict.quote) ||
      u.source === 'room-voice'
    ) {
      target.status = 'review';
      target.reason = verdict.reason;
      return;
    }
    meetings.applyResolution(room, next, u, target.blockerId, verdict.decision);
    target.status = 'confirmed';
    target.reason = verdict.reason;
    retracted = verdict.decision === 'retract';
    activityEvent(
      next,
      u.speakerId ?? 'room:audio',
      `${retracted ? 'Retracted' : 'Confirmed'} blocker from attributed conversation: ${verdict.quote}`,
    );
  });
  if (retracted) meetings.cancelDependents(room, a.id, suggestion.blockerId);
  meetings.afterAction(room);
}
