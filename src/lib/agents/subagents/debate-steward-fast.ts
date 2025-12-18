import { getCerebrasClient, getModelForSteward } from '../fast-steward-config';
import {
  getDebateScorecard,
  commitDebateScorecard,
  getContextDocuments,
  formatContextDocuments,
} from '@/lib/agents/shared/supabase-context';
import { debateScorecardStateSchema, type DebateScorecardState } from '@/lib/agents/debate-scorecard-schema';

const CEREBRAS_MODEL = getModelForSteward('DEBATE_STEWARD_FAST_MODEL');
const client = getCerebrasClient();

const DEBATE_STEWARD_FAST_INSTRUCTIONS = `
You are a fast debate scorecard assistant. Given the current state, context documents, and an instruction, update the state.

Operations you handle:
- Set topic/title: Update the "topic" field (e.g., "Single Origin Coffee", "Climate Policy")
- Add claim: Create new claim with id, side (AFF/NEG), speech, quote, speaker, status: "UNTESTED"
- Update claim status: Change status to UNTESTED, CHECKING, VERIFIED, or REFUTED
- Update scores: Modify players[].score (integers)
- Add timeline event: Append to timeline array with id, timestamp, text, type
- Update player stats: momentum (0-1), streakCount, bsMeter (0-1)
- Parse claims from context: If context documents are provided and instruction says to extract/parse claims, create claims from that content

Real-time scoring (IMPORTANT):
- When you add a new claim from a debate turn, ALWAYS assign claim.scoreDelta as an integer 1–3.
  - Use 1 for a standard argument, 2 for a strong/impactful point, 3 for a decisive/key voter point.
  - Only use 0 if the line is not a substantive claim (meta, filler, duplicate).
- Also set claim.summary (<= 120 chars) to a concise restatement of the claim.
- If scoreDelta > 0, increment the matching player's players[].score by scoreDelta (do not decrement scores).
- Add a "score_change" timeline event whenever you change any player's score.

Parsing debate turns (IMPORTANT):
- If the instruction looks like a debate line (e.g. starts with "Affirmative:", "Negative:", "Affirmative rebuttal:", "Negative rebuttal:", "Judge:"), treat it as a new debate event.
- Add a claim for AFF/NEG lines; for "Judge:" lines add a timeline moderation/argument event and update RFD summary if appropriate.
- Choose a best-effort speech label (AFF → 1AC/2AC/1AR/2AR; NEG → 1NC/2NC/1NR/2NR). If unsure, use 1AC for AFF and 1NC for NEG.

Map + judge memory (IMPORTANT):
- Keep scorecard.map nodes/edges lightly populated:
  - Ensure one MAIN node exists for the debate topic.
  - When you add a claim, add a map node that references claimId and connects to MAIN (REASON for AFF, OBJECTION/REBUTTAL for NEG depending on speech).
- Map schema constraints (MUST FOLLOW):
  - map.nodes[].type MUST be exactly one of: "MAIN" | "REASON" | "OBJECTION" | "REBUTTAL" (all-caps).
  - map.edges[] items MUST be objects with: { "from": "<nodeId>", "to": "<nodeId>" }.
- Keep scorecard.rfd.summary updated:
  - If a Judge line appears, write a short (<= 300 chars) "reason for decision" summary and set metrics.judgeLean (AFF/NEG/NEUTRAL).

IMPORTANT: If the instruction mentions a debate topic (e.g., "debate about X", "topic is Y"), update the "topic" field.
IMPORTANT: If context documents are provided and user asks to "sort into claims" or "extract claims", parse the text and create claim entries.

Claim structure:
{
  id: string (e.g., "AFF-1", "NEG-3"),
  side: "AFF" | "NEG",
  speech: "1AC" | "1NC" | "2AC" | "2NC" | "1AR" | "1NR" | "2AR" | "2NR",
  quote: string,
  speaker: string,
  status: "UNTESTED" | "CHECKING" | "VERIFIED" | "REFUTED",
  strength: { logos: 0.5, pathos: 0.5, ethos: 0.5 },
  confidence: 0.5,
  evidenceCount: 0,
  upvotes: 0,
  scoreDelta: number,
  factChecks: [],
  createdAt: number (epoch ms)
}

Rules:
1. Output STRICT JSON only (no markdown, no commentary).
2. Preserve all existing data - only modify what the instruction specifies.
3. Do NOT invent component IDs; keep the existing componentId.
4. Version/lastUpdated are handled server-side; you may omit or keep them, but ensure state is otherwise complete.

Output format (JSON only):
{
  "summary": string,
  "state": <DebateScorecardState>
}
`;

function extractJsonCandidate(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fallthrough */
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(trimmed.slice(first, last + 1));
  } catch {
    return null;
  }
}

function sanitizeStateCandidate(candidate: any): any {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const next: any = { ...candidate };

  if (next.map && typeof next.map === 'object') {
    const allowedTypes = new Set(['MAIN', 'REASON', 'OBJECTION', 'REBUTTAL']);
    const rawNodes = Array.isArray(next.map.nodes) ? next.map.nodes : [];
    const nodes = rawNodes
      .map((node: any) => {
        const id = typeof node?.id === 'string' ? node.id : undefined;
        const label = typeof node?.label === 'string' ? node.label : typeof node?.text === 'string' ? node.text : undefined;
        const rawType = typeof node?.type === 'string' ? node.type : '';
        const type = rawType ? rawType.toUpperCase() : '';
        if (!id || !label || !type || !allowedTypes.has(type)) return null;
        const claimId = typeof node?.claimId === 'string' ? node.claimId : undefined;
        return claimId ? { id, type, label, claimId } : { id, type, label };
      })
      .filter(Boolean);

    const rawEdges = Array.isArray(next.map.edges) ? next.map.edges : [];
    const edges = rawEdges
      .map((edge: any) => {
        const from =
          typeof edge?.from === 'string'
            ? edge.from
            : typeof edge?.source === 'string'
              ? edge.source
              : typeof edge?.fromId === 'string'
                ? edge.fromId
                : undefined;
        const to =
          typeof edge?.to === 'string'
            ? edge.to
            : typeof edge?.target === 'string'
              ? edge.target
              : typeof edge?.toId === 'string'
                ? edge.toId
                : undefined;
        if (!from || !to) return null;
        return { from, to };
      })
      .filter(Boolean);

    next.map = { nodes, edges };
  }

  return next;
}

export async function runDebateScorecardStewardFast(params: {
  room: string;
  componentId: string;
  intent?: string;
  summary?: string;
  prompt?: string;
  topic?: string;
}) {
  const { room, componentId, intent, summary, prompt, topic } = params;
  const start = Date.now();

  console.log('[DebateStewardFast] start', { room, componentId, intent, topic });

  const record = await getDebateScorecard(room, componentId);
  const currentState = record.state;
  const currentVersion = record.version;

  // Fetch context documents from ContextFeeder
  const contextDocs = await getContextDocuments(room);
  const contextSection = formatContextDocuments(contextDocs);

  const instruction = prompt || summary || intent || 'Update the scorecard';
  const topicInstruction = topic ? `\n\nIMPORTANT: Set the debate topic to: "${topic}"` : '';

  const messages = [
    { role: 'system' as const, content: DEBATE_STEWARD_FAST_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: `Current scorecard state (version ${currentVersion}):\n${JSON.stringify(currentState, null, 2)}\n\n${contextSection ? `Context Documents:\n${contextSection}\n\n` : ''}Instruction: "${instruction}"${topicInstruction}\n\nReturn STRICT JSON only with:\n{\n  "summary": string,\n  "state": <complete DebateScorecardState>\n}\n\nNotes:\n- Keep componentId as "${componentId}".\n- Version/lastUpdated will be handled server-side.`,
    },
  ];

  try {
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
    });

    const choice = response.choices[0]?.message;

    const rawContent = typeof (choice as any)?.content === 'string' ? String((choice as any).content) : '';
    const parsedResponse = extractJsonCandidate(rawContent);
    if (!parsedResponse || typeof parsedResponse !== 'object') {
      console.warn('[DebateStewardFast] No JSON update captured');
      return { status: 'no_change', summary: 'No update needed' };
    }

    const summaryText =
      typeof (parsedResponse as any).summary === 'string' && (parsedResponse as any).summary.trim()
        ? String((parsedResponse as any).summary).trim().slice(0, 240)
        : 'Updated debate scorecard';

    const stateCandidate =
      (parsedResponse as any).state ??
      (typeof (parsedResponse as any).stateJson === 'string' ? extractJsonCandidate(String((parsedResponse as any).stateJson)) : null) ??
      parsedResponse;

    const attemptParse = (value: unknown) => {
      const parsed = debateScorecardStateSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    };

    let updatedState: DebateScorecardState | null = attemptParse(stateCandidate);
    if (!updatedState) {
      updatedState = attemptParse(sanitizeStateCandidate(stateCandidate));
    }
    if (!updatedState && stateCandidate && typeof stateCandidate === 'object') {
      const stripped = { ...(stateCandidate as Record<string, unknown>) };
      delete (stripped as any).map;
      updatedState = attemptParse(stripped);
    }
    if (!updatedState) {
      console.error('[DebateStewardFast] Failed to parse updated state JSON');
      return { status: 'error', summary: 'Failed to parse updated scorecard state' };
    }

    const ensurePositiveScoreDeltas = (
      current: DebateScorecardState,
      next: DebateScorecardState,
    ): DebateScorecardState => {
      const currentIds = new Set((current.claims ?? []).map((c) => c.id));
      let changed = false;

      const patchedClaims = (next.claims ?? []).map((claim) => {
        if (!claim || currentIds.has(claim.id)) return claim;
        const rawDelta = (claim as any).scoreDelta;
        const delta = typeof rawDelta === 'number' && Number.isFinite(rawDelta) ? rawDelta : 0;
        if (delta > 0) return claim;
        changed = true;
        return {
          ...claim,
          scoreDelta: 1,
          summary:
            typeof claim.summary === 'string' && claim.summary.trim()
              ? claim.summary
              : claim.quote?.trim().slice(0, 120) || 'New debate claim',
        };
      });

      return changed ? { ...next, claims: patchedClaims } : next;
    };

    updatedState = ensurePositiveScoreDeltas(currentState, updatedState);

    const committed = await commitDebateScorecard(room, componentId, {
      state: updatedState,
      prevVersion: currentVersion,
    });

    console.log('[DebateStewardFast] complete', {
      room,
      componentId,
      newVersion: committed.version,
      durationMs: Date.now() - start,
    });

    const broadcastUrl = resolveBroadcastUrl();
    if (broadcastUrl) {
      void fetch(broadcastUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          componentId,
          patch: { ...committed.state, version: committed.version },
          summary: summaryText,
        }),
      }).catch((err) => {
        console.warn('[DebateStewardFast] broadcast failed', err);
      });
    }

    return {
      status: 'ok',
      summary: summaryText,
      version: committed.version,
    };

  } catch (error) {
    console.error('[DebateStewardFast] error', { room, componentId, error });
    return {
      status: 'error',
      summary: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function resolveBroadcastUrl(): string | null {
  const derivedPort = process.env.PORT || process.env.NEXT_PUBLIC_PORT;
  const derivedLocal =
    derivedPort && Number.isFinite(Number(derivedPort))
      ? `http://127.0.0.1:${derivedPort}`
      : undefined;
  const candidates = [
    process.env.STEWARD_COMMIT_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.BASE_URL,
    derivedLocal,
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
