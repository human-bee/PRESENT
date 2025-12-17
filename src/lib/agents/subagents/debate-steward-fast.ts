import { getCerebrasClient, getModelForSteward } from '../fast-steward-config';
import {
  getDebateScorecard,
  commitDebateScorecard,
  getContextDocuments,
  formatContextDocuments,
} from '@/lib/agents/shared/supabase-context';
import type { DebateScorecardState } from '@/lib/agents/debate-scorecard-schema';

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
1. Output the COMPLETE updated state via commit_update
2. Preserve all existing data - only modify what the instruction specifies
3. Always increment version by 1
4. Set lastUpdated to current timestamp
5. Update status.lastAction with a brief description
`;

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'commit_update',
      description: 'Commit the updated scorecard state',
      parameters: {
        type: 'object',
        properties: {
          stateJson: {
            type: 'string',
            description: 'The complete updated DebateScorecardState as a JSON string',
          },
          summary: {
            type: 'string',
            description: 'Brief description of what changed (1 sentence)',
          },
        },
        required: ['stateJson', 'summary'],
      },
    },
  },
];

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
      content: `Current scorecard state (version ${currentVersion}):\n${JSON.stringify(currentState, null, 2)}\n\n${contextSection ? `Context Documents:\n${contextSection}\n\n` : ''}Instruction: "${instruction}"${topicInstruction}\n\nApply the instruction and call commit_update with the complete updated state.\nSet version to ${currentVersion + 1} and lastUpdated to ${Date.now()}.`,
    },
  ];

  try {
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0]?.message;

    if (choice?.tool_calls?.[0]) {
      const toolCall = choice.tool_calls[0];
      if (toolCall.function.name === 'commit_update') {
        const args = JSON.parse(toolCall.function.arguments);

        let updatedState: DebateScorecardState;
        try {
          updatedState = JSON.parse(args.stateJson);
        } catch {
          console.error('[DebateStewardFast] Failed to parse stateJson');
          return { status: 'error', summary: 'Failed to parse state JSON' };
        }

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
              patch: { scorecard: { state: updatedState, version: committed.version } },
            }),
          }).catch((err) => {
            console.warn('[DebateStewardFast] broadcast failed', err);
          });
        }

        return {
          status: 'ok',
          summary: args.summary,
          version: committed.version,
        };
      }
    }

    console.warn('[DebateStewardFast] No update captured');
    return { status: 'no_change', summary: 'No update needed' };
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





