import type { TLRecord } from '@tldraw/tlschema';
import {
  activitySchema,
  roomOSSchema,
  type RoomOS,
  type Activity,
  type ActivityKind,
  type Claim,
} from './activity-records';
import { activityTemplates } from './activity-templates';
import { emptyMeeting } from './meeting';
import { emptyAudience, retainAudience } from './audience';
export * from './activity-records';
export * from './activity-templates';
export * from './activity-commands';
export function readRoomOS(records: readonly TLRecord[]): RoomOS {
  const document = records.find((record) => record.typeName === 'document');
  const present = document?.meta.present;
  const raw = present && typeof present === 'object' && !Array.isArray(present) ? present.roomOS : undefined;
  if (raw === undefined) return { version: 1, activeId: null, activities: [] };
  return roomOSSchema.parse(raw);
}
export function makeActivity(kind: ActivityKind, actor: string, activityId: string, topic?: string): Activity {
  return {
    id: activityId,
    kind,
    epoch: 0,
    observations: [],
    comparisons: [],
    resolutionSuggestions: [],
    topic: topic ?? activityTemplates[kind].title,
    createdAt: Date.now(),
    createdBy: actor,
    meeting: emptyMeeting(),
    audience: emptyAudience(),
    ambient: true,
    autoResearch: kind !== 'standup' && kind !== 'live',
    sides: activityTemplates[kind].lanes.map((name, index) => ({
      id: `${activityId}-side-${index}`,
      name,
      color: index,
    })),
    seats: [],
    utterances: [],
    omitted: 0,
    claims: [],
    visuals: [],
    charts: [],
    events: [],
  };
}
export function makeClaim(
  claimId: string,
  value: {
    text: string;
    utteranceId: string | null;
    speakerId: string | null;
    sideId: string | null;
    origin: Claim['origin'];
  },
): Claim {
  return {
    id: claimId,
    epoch: 0,
    quote: '',
    ...value,
    version: 1,
    review: 'open',
    research: {
      status: 'idle',
      token: '',
      version: 1,
      error: null,
      elapsedMs: null,
    },
    evidence: null,
    corrections: [],
  };
}
export function retainActivity(activity: Activity) {
  retainAudience(activity.audience);
  while (
    activity.utterances.length > 60 ||
    new TextEncoder().encode(JSON.stringify(activity.utterances.map(u => ({ ...u, interpretation: null }))))
      .length > 64000
  ) {
    activity.utterances.shift();
    activity.omitted++;
  }
  for (const u of activity.utterances) {
    if (new TextEncoder().encode(JSON.stringify(activity.utterances.map((u) => u.interpretation))).length <= 64000)
      break;
    u.interpretation = null;
  }
  activity.events = activity.events.slice(-80);
  return activitySchema.parse(activity);
}
