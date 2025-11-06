import { z } from 'zod';

export const debateSideEnum = z.enum(['AFF', 'NEG']);
export type DebateSide = z.infer<typeof debateSideEnum>;

export const debateSpeechEnum = z.enum(['1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR']);
export type DebateSpeech = z.infer<typeof debateSpeechEnum>;

export const verdictEnum = z.enum(['ACCURATE', 'PARTIALLY_TRUE', 'UNSUPPORTED', 'FALSE']);
export type Verdict = z.infer<typeof verdictEnum>;

export const impactEnum = z.enum(['KEY_VOTER', 'MAJOR', 'MINOR', 'CREDIBILITY_HIT', 'DROPPED']);
export type Impact = z.infer<typeof impactEnum>;

export const claimStatusEnum = z.enum(['UNTESTED', 'CHECKING', 'VERIFIED', 'REFUTED']);
export type ClaimStatus = z.infer<typeof claimStatusEnum>;

export const debateAchievementEnum = z.enum([
  'firstBlood',
  'evidenceKing',
  'streakMaster',
  'counterPunch',
  'tactician',
]);
export type DebateAchievementKey = z.infer<typeof debateAchievementEnum>;

export const evidenceRefSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  credibility: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).default('UNKNOWN'),
  type: z.enum(['Academic', 'News', 'Government', 'Think Tank', 'Blog']).default('Academic'),
  lastVerified: z.string().optional(), // ISO string
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const factCheckNoteSchema = z.object({
  id: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
});
export type FactCheckNote = z.infer<typeof factCheckNoteSchema>;

export const claimStrengthSchema = z
  .object({
    logos: z.number().min(0).max(1).default(0.5),
    pathos: z.number().min(0).max(1).default(0.5),
    ethos: z.number().min(0).max(1).default(0.5),
  })
  .default({ logos: 0.5, pathos: 0.5, ethos: 0.5 });
export type ClaimStrength = z.infer<typeof claimStrengthSchema>;

export const claimSchema = z.object({
  id: z.string(),
  side: debateSideEnum,
  speech: debateSpeechEnum,
  quote: z.string(),
  speaker: z.string().default('Speaker'),
  summary: z.string().optional(),
  evidenceInline: z.string().optional(),
  status: claimStatusEnum.default('UNTESTED'),
  strength: claimStrengthSchema,
  confidence: z.number().min(0).max(1).default(0.5),
  evidenceCount: z.number().min(0).default(0),
  upvotes: z.number().min(0).default(0),
  scoreDelta: z.number().default(0),
  factChecks: z.array(factCheckNoteSchema).default([]),
  verdict: verdictEnum.optional(),
  impact: impactEnum.optional(),
  mapNodeId: z.string().optional(),
  // We intentionally dropped legacy string timestamps; scorecards are re-seeded with numeric epochs.
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
export type Claim = z.infer<typeof claimSchema>;

export const mapNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['MAIN', 'REASON', 'OBJECTION', 'REBUTTAL']),
  label: z.string(),
  claimId: z.string().optional(),
});
export type MapNode = z.infer<typeof mapNodeSchema>;

export const mapEdgeSchema = z.object({ from: z.string(), to: z.string() });
export type MapEdge = z.infer<typeof mapEdgeSchema>;

export const rfdLinkSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  excerpt: z.string(),
});
export type RfdLink = z.infer<typeof rfdLinkSchema>;

export const debateTimelineEventSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  text: z.string(),
  type: z
    .enum(['argument', 'rebuttal', 'fact_check', 'score_change', 'moderation', 'achievement'])
    .default('argument'),
  side: debateSideEnum.optional(),
  claimId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type DebateTimelineEvent = z.infer<typeof debateTimelineEventSchema>;

export const achievementAwardSchema = z.object({
  id: z.string(),
  key: debateAchievementEnum,
  label: z.string(),
  description: z.string().optional(),
  awardedAt: z.number().default(() => Date.now()),
  claimId: z.string().optional(),
  side: debateSideEnum.optional(),
});
export type AchievementAward = z.infer<typeof achievementAwardSchema>;

export const debatePlayerSchema = z.object({
  id: z.string(),
  label: z.string(),
  side: debateSideEnum,
  color: z.string().default('#F87171'),
  avatarUrl: z.string().optional(),
  score: z.number().default(0),
  streakCount: z.number().default(0),
  momentum: z.number().min(0).max(1).default(0.5),
  bsMeter: z.number().min(0).max(1).default(0.1),
  learningScore: z.number().min(0).max(1).default(0.5),
  achievements: z.array(achievementAwardSchema).default([]),
  summary: z.string().optional(),
  lastUpdated: z.number().optional(),
});
export type DebatePlayer = z.infer<typeof debatePlayerSchema>;

export const roundMetricsSchema = z.object({
  roundScore: z.number().min(0).max(1).default(0.5),
  evidenceQuality: z.number().min(0).max(1).default(0.5),
  judgeLean: z.enum(['AFF', 'NEG', 'NEUTRAL']).default('NEUTRAL'),
  excitement: z.number().min(0).max(1).default(0.4),
});
export type RoundMetrics = z.infer<typeof roundMetricsSchema>;

export const debateFiltersSchema = z.object({
  speaker: z
    .union([z.literal('ALL'), debateSideEnum, debateSpeechEnum])
    .nullable()
    .default('ALL'),
  verdicts: z.array(verdictEnum).default([]),
  statuses: z.array(claimStatusEnum).default([]),
  searchQuery: z.string().default(''),
  activeTab: z.enum(['ledger', 'map', 'rfd', 'sources', 'timeline']).default('ledger'),
});
export type DebateFilters = z.infer<typeof debateFiltersSchema>;

export const debateScorecardStateSchema = z.object({
  componentId: z.string().default('debate-scorecard'),
  version: z.number().default(0),
  topic: z.string().default('Untitled debate'),
  round: z.string().default('Round'),
  showMetricsStrip: z.boolean().default(true),
  factCheckEnabled: z.boolean().default(true),
  filters: debateFiltersSchema.default({ speaker: 'ALL', verdicts: [], statuses: [], searchQuery: '', activeTab: 'ledger' }),
  metrics: roundMetricsSchema.default({ roundScore: 0.5, evidenceQuality: 0.5, judgeLean: 'NEUTRAL', excitement: 0.4 }),
  players: z.array(debatePlayerSchema).default([]),
  claims: z.array(claimSchema).default([]),
  map: z
    .object({ nodes: z.array(mapNodeSchema).default([]), edges: z.array(mapEdgeSchema).default([]) })
    .default({ nodes: [], edges: [] }),
  rfd: z
    .object({
      summary: z.string().default('Judge has not submitted an RFD yet.'),
      links: z.array(rfdLinkSchema).default([]),
    })
    .default({ summary: 'Judge has not submitted an RFD yet.', links: [] }),
  sources: z.array(evidenceRefSchema).default([]),
  timeline: z.array(debateTimelineEventSchema).default([]),
  achievementsQueue: z.array(achievementAwardSchema).default([]),
  status: z
    .object({
      lastAction: z.string().optional(),
      stewardRunId: z.string().optional(),
      pendingVerifications: z.array(z.string()).default([]),
    })
    .default({ lastAction: undefined, stewardRunId: undefined, pendingVerifications: [] }),
  lastUpdated: z.number().default(() => Date.now()),
});
export type DebateScorecardState = z.infer<typeof debateScorecardStateSchema>;

export const debateScorecardSpecSchema = debateScorecardStateSchema.partial({
  version: true,
  filters: true,
  metrics: true,
  players: true,
  claims: true,
  map: true,
  rfd: true,
  sources: true,
  timeline: true,
  achievementsQueue: true,
  status: true,
  lastUpdated: true,
});
export type DebateScorecardSpec = z.infer<typeof debateScorecardSpecSchema>;

export function createDefaultPlayers(): DebatePlayer[] {
  return [
    {
      id: 'player-aff',
      label: 'Affirmative',
      side: 'AFF',
      color: '#38bdf8',
      score: 0,
      streakCount: 0,
      momentum: 0.5,
      bsMeter: 0.08,
      learningScore: 0.55,
      achievements: [],
    },
    {
      id: 'player-neg',
      label: 'Negative',
      side: 'NEG',
      color: '#f87171',
      score: 0,
      streakCount: 0,
      momentum: 0.5,
      bsMeter: 0.08,
      learningScore: 0.55,
      achievements: [],
    },
  ];
}

export function createDefaultScorecardState(topic?: string): DebateScorecardState {
  const base = debateScorecardStateSchema.parse({
    topic: topic && topic.trim().length ? topic : 'Untitled debate',
    players: createDefaultPlayers(),
    timeline: [
      {
        id: `evt-${Date.now()}`,
        timestamp: Date.now(),
        text: 'Scorecard initialized.',
        type: 'moderation',
      },
    ],
  });
  base.status.lastAction = `Debate initialized${base.topic ? ` for ${base.topic}` : ''}.`;
  return base;
}
