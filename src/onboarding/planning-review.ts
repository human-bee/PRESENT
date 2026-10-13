import type { RoomObject } from '../../shared/room';
import { createCapability } from '../widgets/packs';
import { createStarter } from '../widgets/presets';

export function createPlanningReview(actor: string, position: { x: number; y: number }): RoomObject[] {
  const brief = createCapability('brief', actor, position);
  brief.title = 'Planning & review';
  brief.h = 740;
  brief.data.planningReview = true;
  const guide = createStarter('note', actor, { x: position.x + brief.w + 32, y: position.y });
  guide.title = 'A repeatable review';
  guide.data.text = 'Plan. Decide. Act.\n\nCorrect. Review.\n\nReturn here.';
  guide.w = 360; guide.h = 380;
  const timer = createStarter('timer', actor, { x: guide.x, y: guide.y + guide.h + 24 });
  timer.title = 'Five-minute review';
  return [brief, guide, timer];
}

export type PlanningReceipt = {
  version: 1;
  joins: number;
  returns: number;
  artifacts: number;
  corrections: number;
  reportedDone: number;
  firstArtifactMs: number | null;
  firstCorrectionMs: number | null;
  firstReportedDoneMs: number | null;
};
const counts = ['joins', 'returns', 'artifacts', 'corrections', 'reportedDone'] as const;
const timings = ['firstArtifactMs', 'firstCorrectionMs', 'firstReportedDoneMs'] as const;
const key = (roomId: string) => `present:planning-observations:${roomId}`;

/** Opt-in, local aggregate only. No participant IDs, text, URLs or event log. */
export function readPlanningReceipt(roomId: string): PlanningReceipt | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(roomId)) ?? 'null');
    if (!value || value.version !== 1 || counts.some(name => !Number.isInteger(value[name]) || value[name] < 0 || value[name] > 999) || timings.some(name => value[name] !== null && (!Number.isFinite(value[name]) || value[name] < 0 || value[name] > 86_400_000))) return null;
    return Object.fromEntries([['version', 1], ...[...counts, ...timings].map(name => [name, value[name]])]) as PlanningReceipt;
  } catch { return null; }
}
export function savePlanningReceipt(roomId: string, receipt: PlanningReceipt | null) {
  if (receipt) localStorage.setItem(key(roomId), JSON.stringify(receipt));
  else localStorage.removeItem(key(roomId));
}

/** The comparison baseline is memory-only and is rebuilt on every return. */
export function createPlanningObserver(previous: PlanningReceipt | null, clock: () => number = () => performance.now()) {
  const started = clock();
  const receipt: PlanningReceipt = previous ? { ...previous } : { version: 1, joins: 0, returns: 0, artifacts: 0, corrections: 0, reportedDone: 0, firstArtifactMs: null, firstCorrectionMs: null, firstReportedDoneMs: null };
  const increment = (name: typeof counts[number]) => { receipt[name] = Math.min(999, receipt[name] + 1); };
  increment('joins'); if (previous) increment('returns');
  const observed = new Map<string, Record<string, string>>();
  let baseline = true;
  function mark(name: typeof timings[number]) { receipt[name] ??= Math.min(86_400_000, Math.max(0, Math.round(clock() - started))); }
  return {
    observe(objects: RoomObject[]) {
      for (const object of objects.filter(item => item.data.planningReview === true && item.data.capability === 'brief').slice(0, 32)) {
        const state = object.data.state as Record<string, unknown> | undefined;
        const current: Record<string, string> = {};
        for (const [field, value] of Object.entries(state ?? {}).slice(0, 128)) {
          if (field === 'summary' && typeof value === 'string') current[field] = value.slice(0, 16000);
          if ((field.startsWith('action:') || field.startsWith('decision:')) && value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') current[field] = value.text.slice(0, 16000);
          if (field.startsWith('status:') && typeof value === 'string') current[field] = value;
        }
        const old = observed.get(object.id);
        if (!old && observed.size >= 32) continue;
        if (!old) { if (!baseline || !previous) increment('artifacts'); mark('firstArtifactMs'); }
        else for (const [field, value] of Object.entries(current)) {
          if (field.startsWith('status:')) { if (old[field] && old[field] !== 'Done' && value === 'Done') { increment('reportedDone'); mark('firstReportedDoneMs'); } }
          else if (old[field]?.trim() && value.trim() && old[field] !== value) { increment('corrections'); mark('firstCorrectionMs'); }
        }
        observed.set(object.id, current);
      }
      baseline = false;
      return { ...receipt };
    },
  };
}
