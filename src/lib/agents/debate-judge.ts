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
} from '@/lib/agents/debate-scorecard-schema';

const logWithTs = (label: string, payload: Record<string, unknown>) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

export function isStartDebate(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!/\bdebate\b/.test(lower)) return false;
  return /\b(start|begin|launch|create|open|setup|set\s*up|initiate|kick\s*off|analysis|scorecard)\b/.test(lower);
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
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3000',
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

export const get_current_scorecard = tool({
  name: 'get_current_scorecard',
  description: 'Fetch the current debate scorecard state for the specified room + component.',
  parameters: GetScorecardArgs,
  async execute({ room, componentId }) {
    const start = Date.now();
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

    const parsedState = debateScorecardStateSchema.parse({
      ...(typeof rawState === 'object' && rawState ? (rawState as Record<string, unknown>) : {}),
      componentId,
    });
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
          logWithTs('⚠️ [DebateSteward] commit_conflict', {
            room,
            componentId,
            latestVersion: latest.version,
          });
          continue;
        }
        throw error;
      }
    }
    throw new Error('FAILED_COMMIT');
  },
});

const DEBATE_SCORECARD_INSTRUCTIONS = `You are the debate scorekeeper steward embedded in a live TLDraw canvas.

Workflow each turn:
1. Call get_current_scorecard to obtain the latest canonical state (claims, players, timeline).
2. Call get_context(windowMs=60000) to read the recent transcript for new claims, challenges, or moderator guidance.
3. Update the scorecard state atomically:
   - Add or edit claims with side, speech, quote, status, strength, evidenceCount, upvotes.
   - When fact-checking, set claim.status ("CHECKING" → "VERIFIED"/"REFUTED"), update confidence, factChecks, and evidence references.
   - Maintain players[].score, streakCount, momentum, bsMeter, learningScore. Unlock achievements (debateAchievementEnum) when thresholds are met.
   - Append timeline events describing key actions. Use type "achievement" when celebrating awards, "fact_check" for verification results, and include claimId/side metadata.
   - Keep status.pendingVerifications in sync (claim IDs still under review) and set status.lastAction to a concise scoreboard update (<= 160 characters).
4. Persist the *entire* updated state by calling commit_scorecard with stateJson (a JSON string of the full state). Always send prevVersion from get_current_scorecard to enforce optimistic concurrency.
   - Serialize the state with JSON.stringify; do not wrap it in Markdown or include commentary inside the string.
5. Your final natural language reply must be short (<= 1 sentence) and summarize the visible change (e.g., "Verified AFF-2; score now 32–28").

Additional guidance:
- Never invent component IDs; use componentId from inputs or the fetched state.
- Prefer precise JSON edits: keep arrays sorted by creation time, preserve existing IDs, and avoid removing historical data unless instructed.
- Coerce numeric fields (scores, counts, momentum) to sensible ranges: scores are integers, momentum/bsMeter/learningScore ∈ [0,1].
- Use claimStatusEnum values exactly; this controls client UI spinners.
- When awarding achievements (debateAchievementEnum), append to player.achievements with structured objects ({ id, key, label, description?, awardedAt, side, claimId }) and push an "achievement" timeline entry referencing the same award id.
- If no update is necessary, still return a short acknowledgement like "No new debate events detected."`;

export const debateScorecardSteward = new Agent({
  name: 'DebateScorecardSteward',
  model: 'gpt-5-mini',
  instructions: DEBATE_SCORECARD_INSTRUCTIONS,
  tools: [get_current_scorecard, get_context, commit_scorecard],
});

export async function runDebateScorecardSteward(params: {
  room: string;
  componentId: string;
  windowMs?: number;
  intent?: string;
  summary?: string;
  prompt?: string;
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
