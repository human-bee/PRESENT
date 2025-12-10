import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import {
  getDebateScorecard,
  commitDebateScorecard,
  getTranscriptWindow,
} from '@/lib/agents/shared/supabase-context';
import {
  debateScorecardStateSchema,
  claimStatusEnum,
  debateAchievementEnum,
  type DebateScorecardState,
  type DebatePlayer,
  type Claim,
  type DebateTimelineEvent,
  type MapNode,
  type MapEdge,
  type EvidenceRef,
  type AchievementAward,
  type FactCheckNote,
  type RfdLink,
} from '@/lib/agents/debate-scorecard-schema';
import { performWebSearch, webSearchArgsSchema } from '@/lib/agents/tools/web-search';

const logWithTs = (label: string, payload: Record<string, unknown>) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

type ScorecardSeedRecord = {
  state: DebateScorecardState;
  version: number;
  lastUpdated: number;
};

const scorecardSeedCache = new Map<string, ScorecardSeedRecord>();

const seedCacheKey = (room: string, componentId: string) => `${room}::${componentId}`;

export function seedScorecardState(
  room: string,
  componentId: string,
  record: { state: DebateScorecardState; version: number; lastUpdated?: number },
) {
  const key = seedCacheKey(room, componentId);
  scorecardSeedCache.set(key, {
    state: record.state,
    version: record.version,
    lastUpdated: record.lastUpdated ?? Date.now(),
  });
}

export function isStartDebate(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!/\bdebate\b/.test(lower)) return false;
  return /\b(start|begin|launch|create|open|setup|set\s*up|initiate|kick\s*off|analysis|scorecard)\b/.test(lower);
}

const FACT_CHECK_PHRASES = ['fact check', 'fact-check', 'factcheck', 'run a fact check', 'request a fact check'];
const FACT_CHECK_VERBS = ['fact check', 'fact-check', 'factcheck', 'verify', 'confirm', 'double check', 'double-check'];
const FACT_CHECK_TARGETS = ['claim', 'argument', 'statement', 'fact', 'evidence', 'assertion'];
const FACT_CHECK_REQUEST_CUES = ['can you', 'could you', 'please', 'would you', 'need you to', 'i want you to', 'let\'s'];

export function isExplicitFactCheckRequest(text: string): boolean {
  const normalized = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (FACT_CHECK_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  const hasVerb = FACT_CHECK_VERBS.some((verb) => normalized.includes(verb));
  if (!hasVerb) return false;
  const hasTarget = FACT_CHECK_TARGETS.some((target) => normalized.includes(target));
  if (!hasTarget) return false;
  const hasCue = FACT_CHECK_REQUEST_CUES.some((cue) => normalized.includes(cue)) || /^(?:fact\s*[-]?check|verify|confirm|double\s*[-]?check)\b/.test(normalized);
  if (hasCue) return true;
  return normalized.includes('?');
}

const GetScorecardArgs = z.object({
  room: z.string(),
  componentId: z.string(),
});

const GetContextArgs = z.object({
  room: z.string(),
  windowMs: z.number().min(1_000).max(600_000).nullable(),
});

const CommitScorecardArgs = z.object({
  room: z.string(),
  componentId: z.string(),
  stateJson: z.string().min(2, 'stateJson must contain the full scorecard JSON.'),
  prevVersion: z.number().int().nonnegative().nullable(),
  statusNote: z.string().max(500).nullish(),
});

const SearchEvidenceArgs = z
  .object({
    room: z.string(),
    componentId: z.string(),
  })
  .merge(
    webSearchArgsSchema.pick({
      query: true,
      maxResults: true,
      includeAnswer: true,
    }),
  );

function resolveCommitUrl() {
  const port = process.env.PORT || process.env.NEXT_PUBLIC_PORT;
  const derivedLocal =
    port && Number.isFinite(Number(port)) ? `http://127.0.0.1:${port}` : undefined;
  const candidates = [
    process.env.STEWARD_COMMIT_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.BASE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    derivedLocal,
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const normalized = candidate.startsWith('http') ? candidate : `https://${candidate}`;
      return new URL('/api/steward/commit', normalized).toString();
    } catch {
      continue;
    }
  }
  return null;
}

type WithId = { id: string };

const mergeById = <T extends WithId>(
  current?: readonly T[] | null,
  incoming?: readonly T[] | null,
): T[] => {
  const base = Array.isArray(current) ? current : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const baseMap = new Map(base.map((item) => [item.id, item]));
  const merged: T[] = [];
  const seen = new Set<string>();

  for (const item of next) {
    const existing = baseMap.get(item.id);
    merged.push(existing ? ({ ...existing, ...item } as T) : ({ ...item } as T));
    seen.add(item.id);
  }

  for (const item of base) {
    if (!seen.has(item.id)) {
      merged.push({ ...item });
    }
  }

  return merged;
};

const mergeFactChecks = (
  current?: readonly FactCheckNote[] | null,
  incoming?: readonly FactCheckNote[] | null,
) => mergeById(current, incoming);

const dedupeFactChecks = (notes: readonly FactCheckNote[] | null | undefined): FactCheckNote[] => {
  if (!notes || notes.length === 0) return [];
  const seen = new Map<string, FactCheckNote>();
  for (const note of notes) {
    const key = note.id?.trim() ? note.id : note.summary?.trim() || cryptoKeyFromObject(note);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, { ...note });
    }
  }
  return Array.from(seen.values());
};

const cryptoKeyFromObject = (value: FactCheckNote): string => {
  try {
    return JSON.stringify({ summary: value.summary, refs: value.evidenceRefs?.slice(0, 5) || [] });
  } catch {
    return Math.random().toString(36).slice(2);
  }
};

const mergePlayers = (
  current?: readonly DebatePlayer[] | null,
  incoming?: readonly DebatePlayer[] | null,
): DebatePlayer[] => {
  const base = Array.isArray(current) ? current : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const baseMap = new Map(base.map((player) => [player.id, player]));
  const merged: DebatePlayer[] = [];
  const seen = new Set<string>();

  for (const player of next) {
    const existing = baseMap.get(player.id);
    merged.push(
      existing
        ? {
            ...existing,
            ...player,
            achievements: dedupeAchievements(
              mergeById(existing.achievements, player.achievements),
            ),
          }
        : {
            ...player,
            achievements: dedupeAchievements(mergeById([], player.achievements)),
          },
    );
    seen.add(player.id);
  }

  for (const player of base) {
    if (!seen.has(player.id)) {
      merged.push({
        ...player,
        achievements: dedupeAchievements(mergeById(player.achievements, [])),
      });
    }
  }

  return merged;
};

const mergeClaims = (
  current?: readonly Claim[] | null,
  incoming?: readonly Claim[] | null,
): Claim[] => {
  const base = Array.isArray(current) ? current : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const baseMap = new Map(base.map((claim) => [claim.id, claim]));
  const merged: Claim[] = [];
  const seen = new Set<string>();

  for (const claim of next) {
    const existing = baseMap.get(claim.id);
    merged.push(
      existing
        ? {
            ...existing,
            ...claim,
            factChecks: mergeFactChecks(existing.factChecks, claim.factChecks),
          }
        : {
            ...claim,
            factChecks: mergeFactChecks([], claim.factChecks),
          },
    );
    seen.add(claim.id);
  }

  for (const claim of base) {
    if (!seen.has(claim.id)) {
      merged.push({
        ...claim,
        factChecks: mergeFactChecks(claim.factChecks, []),
      });
    }
  }

  return merged;
};

const mergeTimeline = (
  current?: readonly DebateTimelineEvent[] | null,
  incoming?: readonly DebateTimelineEvent[] | null,
) => mergeById(current, incoming);

const mergeSources = (current?: readonly EvidenceRef[] | null, incoming?: readonly EvidenceRef[] | null) =>
  mergeById(current, incoming);

const mergeAchievementsQueue = (
  current?: readonly AchievementAward[] | null,
  incoming?: readonly AchievementAward[] | null,
) => mergeById(current, incoming);

const dedupeAchievements = (awards: readonly AchievementAward[] | null | undefined): AchievementAward[] => {
  if (!awards || awards.length === 0) return [];
  const merged = new Map<string, AchievementAward>();
  for (const award of awards) {
    const claimKey = (award.claimId ?? '').toLowerCase();
    const key = `${award.key}:${claimKey}:${award.side ?? ''}`;
    const existing = merged.get(key);
    if (!existing || (award.awardedAt ?? 0) > (existing.awardedAt ?? 0)) {
      merged.set(key, { ...award });
    }
  }
  return Array.from(merged.values());
};

const dedupeSources = (sources: readonly EvidenceRef[] | null | undefined): EvidenceRef[] => {
  if (!sources || sources.length === 0) return [];
  const map = new Map<string, EvidenceRef>();
  for (const source of sources) {
    const key = source.id || `${source.title ?? ''}:${source.url ?? ''}`;
    if (!map.has(key)) {
      map.set(key, { ...source, id: source.id || `source-${key}` });
    }
  }
  return Array.from(map.values());
};

const sortTimelineChronologically = (
  events: readonly DebateTimelineEvent[] | null | undefined,
): DebateTimelineEvent[] => {
  if (!events || events.length === 0) return [];
  return [...events].sort((a, b) => {
    const aTs = a.timestamp ?? 0;
    const bTs = b.timestamp ?? 0;
    if (aTs !== bTs) return aTs - bTs;
    return (a.id ?? '').localeCompare(b.id ?? '');
  });
};

const collectPendingVerificationIds = (
  claims: readonly Claim[] | undefined,
  ...additionalLists: (readonly string[] | undefined)[]
): string[] => {
  const pending = new Set<string>();
  const claimById = new Map((claims ?? []).map((claim) => [claim.id, claim]));
  for (const claim of claims ?? []) {
    if (claim.status === 'CHECKING' && claim.id) {
      pending.add(claim.id);
    }
  }
  for (const list of additionalLists) {
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (!id) continue;
      const claim = claimById.get(id);
      if (claim && claim.status === 'CHECKING') {
        pending.add(id);
      }
    }
  }
  return Array.from(pending.values());
};

const normalizeScorecardState = (state: DebateScorecardState): DebateScorecardState => {
  const normalizedPlayers = state.players.map((player) => ({
    ...player,
    achievements: dedupeAchievements(player.achievements),
  }));

  const normalizedClaims = state.claims.map((claim) => ({
    ...claim,
    factChecks: dedupeFactChecks(claim.factChecks),
  }));

  const normalizedSources = dedupeSources(state.sources);
  const normalizedAchievementsQueue = dedupeAchievements(state.achievementsQueue);
  const normalizedTimeline = sortTimelineChronologically(state.timeline);
  const pendingVerifications = collectPendingVerificationIds(
    normalizedClaims,
    state.status?.pendingVerifications,
  );

  return {
    ...state,
    players: normalizedPlayers,
    claims: normalizedClaims,
    sources: normalizedSources,
    achievementsQueue: normalizedAchievementsQueue,
    timeline: normalizedTimeline,
    status: {
      ...state.status,
      pendingVerifications,
    },
  };
};

const mergeRfdLinks = (current?: readonly RfdLink[] | null, incoming?: readonly RfdLink[] | null) =>
  mergeById(current, incoming);

const mergeMapNodes = (current?: readonly MapNode[] | null, incoming?: readonly MapNode[] | null) =>
  mergeById(current, incoming);

const mergeMapEdges = (current?: readonly MapEdge[] | null, incoming?: readonly MapEdge[] | null): MapEdge[] => {
  const base = Array.isArray(current) ? current : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const baseMap = new Map(base.map((edge) => [`${edge.from}->${edge.to}`, edge]));
  const merged: MapEdge[] = [];
  const seen = new Set<string>();

  for (const edge of next) {
    const key = `${edge.from}->${edge.to}`;
    const existing = baseMap.get(key);
    merged.push(existing ? { ...existing, ...edge } : { ...edge });
    seen.add(key);
  }

  for (const edge of base) {
    const key = `${edge.from}->${edge.to}`;
    if (!seen.has(key)) {
      merged.push({ ...edge });
    }
  }

  return merged;
};

const mergeScorecardStates = (
  current: DebateScorecardState,
  incoming: DebateScorecardState,
): DebateScorecardState => {
  const mergedPlayers = mergePlayers(current.players, incoming.players);
  const mergedClaims = mergeClaims(current.claims, incoming.claims);
  const normalizedClaims = mergedClaims.map((claim) => ({
    ...claim,
    factChecks: dedupeFactChecks(claim.factChecks),
  }));
  const mergedTimeline = mergeTimeline(current.timeline, incoming.timeline);
  const mergedSources = dedupeSources(mergeSources(current.sources, incoming.sources));
  const mergedAchievementsQueue = dedupeAchievements(
    mergeAchievementsQueue(
      current.achievementsQueue,
      incoming.achievementsQueue,
    ),
  );
  const mergedMapNodes = mergeMapNodes(current.map?.nodes, incoming.map?.nodes);
  const mergedMapEdges = mergeMapEdges(current.map?.edges, incoming.map?.edges);
  const mergedRfd = {
    ...current.rfd,
    ...incoming.rfd,
    links: mergeRfdLinks(current.rfd?.links, incoming.rfd?.links),
  };

  const claimsById = new Map(mergedClaims.map((claim) => [claim.id, claim]));
  const isPendingStatus = (status?: Claim['status']) => status === claimStatusEnum.enum.CHECKING;

  const buildPending = () => {
    const pendingSet = new Set<string>();
    const incomingStatus = incoming.status ?? {};
    const currentStatus = current.status ?? {};
    const incomingPending = Array.isArray(incomingStatus.pendingVerifications)
      ? incomingStatus.pendingVerifications
      : [];
    const currentPending = Array.isArray(currentStatus.pendingVerifications)
      ? currentStatus.pendingVerifications
      : [];
    const incomingHasPending = Object.prototype.hasOwnProperty.call(
      incomingStatus,
      'pendingVerifications',
    );

    const addIfPending = (id: string | undefined | null) => {
      if (!id) return;
      if (pendingSet.has(id)) return;
      const claim = claimsById.get(id);
      if (!claim) return;
      if (!isPendingStatus(claim.status)) return;
      pendingSet.add(id);
    };

    const seeds = incomingHasPending ? incomingPending : currentPending;
    for (const id of seeds) addIfPending(id);
    for (const id of currentPending) addIfPending(id);

    return Array.from(pendingSet);
  };

  const mergedStatus = {
    ...current.status,
    ...incoming.status,
    pendingVerifications: buildPending(),
  };

  const merged: DebateScorecardState = {
    ...current,
    ...incoming,
    componentId: incoming.componentId ?? current.componentId,
    players: mergedPlayers,
    claims: normalizedClaims,
    timeline: sortTimelineChronologically(mergedTimeline),
    sources: mergedSources,
    achievementsQueue: mergedAchievementsQueue,
    map: {
      nodes: mergedMapNodes,
      edges: mergedMapEdges,
    },
    rfd: mergedRfd,
    status: mergedStatus,
    filters: { ...current.filters, ...incoming.filters },
    metrics: { ...current.metrics, ...incoming.metrics },
    lastUpdated: Math.max(current.lastUpdated ?? 0, incoming.lastUpdated ?? Date.now()),
  };

  return normalizeScorecardState(merged);
};

export const get_current_scorecard = tool({
  name: 'get_current_scorecard',
  description: 'Fetch the current debate scorecard state for the specified room + component.',
  parameters: GetScorecardArgs,
  async execute({ room, componentId }) {
    const start = Date.now();
    const cacheKey = seedCacheKey(room, componentId);
    const seeded = scorecardSeedCache.get(cacheKey);
    if (seeded) {
      scorecardSeedCache.delete(cacheKey);
      logWithTs('📊 [DebateSteward] get_current_scorecard (seeded)', {
        room,
        componentId,
        version: seeded.version,
        ms: Date.now() - start,
      });
      return {
        state: seeded.state,
        version: seeded.version,
        lastUpdated: seeded.lastUpdated,
      };
    }

    const record = await getDebateScorecard(room, componentId);
    logWithTs('📊 [DebateSteward] get_current_scorecard', {
      room,
      componentId,
      version: record.version,
      ms: Date.now() - start,
    });
    return record;
  },
});

export const get_context = tool({
  name: 'get_context',
  description: 'Fetch recent transcript lines for situational awareness.',
  parameters: GetContextArgs,
  async execute({ room, windowMs }) {
    const span = typeof windowMs === 'number' ? windowMs : 60_000;
    const start = Date.now();
    const window = await getTranscriptWindow(room, span);
    logWithTs('🗣️ [DebateSteward] get_context', {
      room,
      windowMs: span,
      lines: Array.isArray(window?.transcript) ? window.transcript.length : 0,
      ms: Date.now() - start,
    });
    return window;
  },
});

export const search_evidence = tool({
  name: 'search_evidence',
  description:
    'Perform a live web search to collect supporting or refuting evidence. Returns a summary and top sources.',
  parameters: SearchEvidenceArgs,
  async execute({ room, componentId, query, maxResults, includeAnswer }) {
    try {
      const result = await performWebSearch({
        query,
        maxResults,
        includeAnswer,
      });
      logWithTs('🔍 [DebateSteward] search_evidence', {
        room,
        componentId,
        query,
        hits: result.hits.length,
      });
      return {
        status: 'ok',
        summary: result.summary,
        hits: result.hits,
        model: result.model,
        query: result.query,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWithTs('⚠️ [DebateSteward] search_evidence_failed', {
        room,
        componentId,
        query,
        error: message,
      });
      return {
        status: 'error',
        error: message,
      };
    }
  },
});

export const commit_scorecard = tool({
  name: 'commit_scorecard',
  description:
    'Persist the full debate scorecard state with optimistic concurrency. Always send the complete state as a JSON string.',
  parameters: CommitScorecardArgs,
  async execute({ room, componentId, stateJson, prevVersion, statusNote }) {
    let expectedPrev = typeof prevVersion === 'number' ? prevVersion : undefined;
    let rawState: unknown;

    try {
      rawState = JSON.parse(stateJson);
    } catch (error) {
      logWithTs('⚠️ [DebateSteward] commit_state_parse_error', {
        room,
        componentId,
        error: error instanceof Error ? error.message : error,
      });
      throw new Error('INVALID_STATE_JSON');
    }

    let parsedState = normalizeScorecardState(
      debateScorecardStateSchema.parse({
        ...(typeof rawState === 'object' && rawState ? (rawState as Record<string, unknown>) : {}),
        componentId,
      }),
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const commitStart = Date.now();
        const record = await commitDebateScorecard(room, componentId, {
          state: parsedState,
          prevVersion: expectedPrev,
        });
        logWithTs('✅ [DebateSteward] commit_scorecard', {
          room,
          componentId,
          version: record.version,
          ms: Date.now() - commitStart,
        });

        const broadcastUrl = resolveCommitUrl();
        if (broadcastUrl) {
          void (async () => {
            try {
              console.log('[DebateSteward] Broadcasting update', {
                room,
                componentId,
                version: record.version,
                broadcastUrl,
                patchKeys: Object.keys(record.state || {}),
              });
              await fetch(broadcastUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  room,
                  componentId,
                  patch: { ...record.state, version: record.version },
                  summary: statusNote,
                }),
              });
              logWithTs('📡 [DebateSteward] broadcast_scorecard', {
                room,
                componentId,
                version: record.version,
              });
            } catch (error) {
              logWithTs('⚠️ [DebateSteward] broadcast_failed', {
                room,
                componentId,
                error: error instanceof Error ? error.message : error,
              });
            }
          })();
        } else {
          logWithTs('⚠️ [DebateSteward] no_broadcast_url', { room, componentId });
        }

        return {
          status: 'ok',
          version: record.version,
        };
      } catch (error) {
        if (attempt === 0 && error instanceof Error && error.message === 'CONFLICT') {
          const latest = await getDebateScorecard(room, componentId);
          expectedPrev = latest.version;
          parsedState = normalizeScorecardState(
            mergeScorecardStates(latest.state, parsedState),
          );
          logWithTs('⚠️ [DebateSteward] commit_conflict', {
            room,
            componentId,
            latestVersion: latest.version,
            resolvedWith: 'merge',
          });
          continue;
        }
        throw error;
      }
    }
    throw new Error('FAILED_COMMIT');
  },
});

const STATUS_VALUES = claimStatusEnum.options.join(', ');
const ACHIEVEMENT_VALUES = debateAchievementEnum.options.join(', ');

const DEBATE_SCORECARD_INSTRUCTIONS = `You are the debate scorekeeper steward embedded in a live TLDraw canvas.

Workflow each turn:
1. Call get_current_scorecard to obtain the latest canonical state (claims, players, timeline).
2. Call get_context(windowMs=60000) to read the recent transcript for new claims, challenges, or moderator guidance.
3. Before declaring a claim VERIFIED or REFUTED, call search_evidence (maxResults 2-3) to gather live supporting sources. Record the returned hits in sources[] (use their id/title/url), add concise factChecks[], and set each factCheck.evidenceRefs to the IDs of supporting sources.
4. Update the scorecard state atomically:
   - **IMPORTANT**: If the input includes a "topic" field, ALWAYS update the scorecard's topic to that value.
   - Add or edit claims with side, speech, quote, status, strength, evidenceCount, upvotes.
   - When fact-checking, set claim.status ("CHECKING" → "VERIFIED"/"REFUTED"), update confidence, factChecks, and evidence references.
   - Maintain players[].score, streakCount, momentum, bsMeter, learningScore. Unlock achievements (debateAchievementEnum) when thresholds are met.
   - Append timeline events describing key actions. Use type "achievement" when celebrating awards, "fact_check" for verification results, and include claimId/side metadata.
   - Keep status.pendingVerifications in sync (claim IDs still under review) and set status.lastAction to a concise scoreboard update (<= 160 characters).
5. Persist the *entire* updated state by calling commit_scorecard with stateJson (a JSON string of the full state). Always send prevVersion from get_current_scorecard to enforce optimistic concurrency.
   - Serialize the state with JSON.stringify; do not wrap it in Markdown or include commentary inside the string.
6. Your final natural language reply must be short (<= 1 sentence) and summarize the visible change (e.g., "Verified AFF-2; score now 32–28").

Additional guidance:
- If the input contains a "topic" field, set the scorecard's topic to that value and commit immediately.
- If intent === 'scorecard.fact_check', prioritize moving any pending or newly mentioned claims into CHECKING, run search_evidence immediately, then advance statuses with concise factChecks and evidence links before responding.
- Never invent component IDs; use componentId from inputs or the fetched state.
- Prefer precise JSON edits: keep arrays sorted by creation time, preserve existing IDs, and avoid removing historical data unless instructed.
 - Coerce numeric fields (scores, counts, momentum) to sensible ranges: scores are integers, momentum/bsMeter/learningScore ∈ [0,1].
 - Use claimStatusEnum values exactly (${STATUS_VALUES}); this controls client UI spinners.
 - When awarding achievements (keys: ${ACHIEVEMENT_VALUES}), append to player.achievements with structured objects ({ id, key, label, description?, awardedAt, side, claimId }) and push an "achievement" timeline entry referencing the same award id.
 - If no update is necessary, still return a short acknowledgement like "No new debate events detected."`;

export const debateScorecardSteward = new Agent({
  name: 'DebateScorecardSteward',
  model: 'gpt-5-mini',
  modelSettings: { providerData: { reasoning: { effort: 'low' } } },
  instructions: DEBATE_SCORECARD_INSTRUCTIONS,
  tools: [get_current_scorecard, get_context, search_evidence, commit_scorecard],
});

export async function runDebateScorecardSteward(params: {
  room: string;
  componentId: string;
  windowMs?: number;
  intent?: string;
  summary?: string;
  prompt?: string;
  topic?: string;
}) {
  const payload = {
    ...params,
    windowMs: params.windowMs ?? 60_000,
    timestamp: Date.now(),
  };
  logWithTs('🚀 [DebateSteward] run.start', {
    room: params.room,
    componentId: params.componentId,
    windowMs: payload.windowMs,
    intent: params.intent,
    topic: params.topic,
  });
  const result = await run(debateScorecardSteward, JSON.stringify(payload));
  logWithTs('🏁 [DebateSteward] run.complete', {
    room: params.room,
    componentId: params.componentId,
    output: result.finalOutput,
  });
  return result.finalOutput;
}

export type { DebateScorecardState };
