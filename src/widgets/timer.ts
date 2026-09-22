export type TimerState = { durationMs: number; endsAt: number | null; remainingMs: number };
export type TimerAction = 'start' | 'pause' | 'reset';

export function readTimer(data: Record<string, unknown>): TimerState {
  const durationMs = typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? Math.max(1000, Math.min(data.durationMs, 86_400_000)) : 300_000;
  const endsAt = typeof data.endsAt === 'number' && Number.isFinite(data.endsAt) ? data.endsAt : null;
  const remainingMs = typeof data.remainingMs === 'number' && Number.isFinite(data.remainingMs) ? Math.max(0, Math.min(data.remainingMs, durationMs)) : durationMs;
  return { durationMs, endsAt, remainingMs };
}

export function remainingTime(timer: TimerState, now: number): number {
  return timer.endsAt === null ? timer.remainingMs : Math.max(0, Math.min(timer.durationMs, timer.endsAt - now));
}

export function changeTimer(timer: TimerState, action: TimerAction, now: number): TimerState {
  if (action === 'reset') return { ...timer, endsAt: null, remainingMs: timer.durationMs };
  const remainingMs = remainingTime(timer, now);
  if (action === 'pause') return { ...timer, endsAt: null, remainingMs };
  const restartMs = remainingMs || timer.durationMs;
  return { ...timer, endsAt: now + restartMs, remainingMs: restartMs };
}

export function formatRemaining(milliseconds: number): string {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
