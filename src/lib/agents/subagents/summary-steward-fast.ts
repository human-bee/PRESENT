import { getCerebrasClient, getModelForSteward, isFastStewardReady } from '../fast-steward-config';
import { getTranscriptWindow, getContextDocuments, formatContextDocuments } from '@/lib/agents/shared/supabase-context';
import { BYOK_REQUIRED } from '@/lib/agents/shared/byok-flags';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

const CEREBRAS_MODEL = getModelForSteward('SUMMARY_STEWARD_FAST_MODEL');

const SUMMARY_SYSTEM = `
You are a fast meeting summarizer for a realtime collaborative workspace.
Goal: produce a concise CRM-ready summary for future meetings (not addressed to the current user).
Focus on: what happened, key decisions, open questions, and actionable follow-ups with owners if clear.
Be accurate, avoid hallucinating owners or commitments.
Return a single commit_summary tool call.
`;

const summaryTools = [
  {
    type: 'function' as const,
    function: {
      name: 'commit_summary',
      description: 'Return a structured meeting summary',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          highlights: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'array', items: { type: 'string' } },
          actionItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string' },
                owner: { type: 'string' },
                due: { type: 'string' },
              },
              required: ['task'],
              additionalProperties: false,
            },
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary'],
      },
    },
  },
];

type SummaryResult = {
  title?: string;
  summary: string;
  highlights?: string[];
  decisions?: string[];
  actionItems?: Array<{ task: string; owner?: string; due?: string }>;
  tags?: string[];
};

const resolveWindowMs = (profile?: string) => {
  if (profile === 'glance') return 30_000;
  if (profile === 'deep') return 240_000;
  if (profile === 'archive') return 720_000;
  return 180_000;
};

export async function runSummaryStewardFast(params: {
  room: string;
  instruction?: string;
  contextBundle?: string;
  contextProfile?: string;
  billingUserId?: string;
}): Promise<SummaryResult> {
  const { room, instruction, contextBundle, contextProfile, billingUserId } = params;
  const [transcript, contextDocs] = await Promise.all([
    getTranscriptWindow(room, resolveWindowMs(contextProfile)),
    getContextDocuments(room),
  ]);
  const transcriptLines = Array.isArray(transcript?.transcript)
    ? transcript.transcript
        .filter((entry) => entry && typeof entry.text === 'string')
        .slice(-80)
        .map((entry) => `${entry.participantId || 'Speaker'}: ${entry.text}`)
        .join('\n')
    : '';
  const contextSection = contextDocs.length > 0 ? formatContextDocuments(contextDocs) : '';

  const messages = [
    { role: 'system' as const, content: SUMMARY_SYSTEM },
    {
      role: 'user' as const,
      content: [
        instruction ? `Instruction: ${instruction}` : '',
        contextBundle ? `Context Bundle:\n${contextBundle}` : '',
        contextSection ? `Context Documents:\n${contextSection}` : '',
        transcriptLines ? `Transcript:\n${transcriptLines}` : '',
        'Return commit_summary.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  const cerebrasKey = BYOK_REQUIRED && billingUserId
    ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
    : null;

  if (BYOK_REQUIRED && !cerebrasKey) {
    const fallbackSummary = transcriptLines.slice(0, 800) || 'Summary unavailable.';
    return { summary: fallbackSummary };
  }

  if (!BYOK_REQUIRED && !isFastStewardReady()) {
    const fallbackSummary = transcriptLines.slice(0, 800) || 'Summary unavailable.';
    return { summary: fallbackSummary };
  }

  try {
    const client = getCerebrasClient(cerebrasKey ?? undefined);
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools: summaryTools,
      tool_choice: 'auto',
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name === 'commit_summary') {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
      if (summary) {
        return {
          title: typeof args.title === 'string' ? args.title.trim() : undefined,
          summary,
          highlights: Array.isArray(args.highlights) ? args.highlights : undefined,
          decisions: Array.isArray(args.decisions) ? args.decisions : undefined,
          actionItems: Array.isArray(args.actionItems) ? args.actionItems : undefined,
          tags: Array.isArray(args.tags) ? args.tags : undefined,
        };
      }
    }
  } catch (error) {
    console.error('[SummaryStewardFast] Error:', error);
  }

  const fallbackSummary = transcriptLines.slice(0, 800) || 'Summary unavailable.';
  return { summary: fallbackSummary };
}
