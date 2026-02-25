import { getCerebrasClient, getModelForSteward, isFastStewardReady } from '../fast-steward-config';
import { getTranscriptWindow, getContextDocuments, formatContextDocuments } from '@/lib/agents/shared/supabase-context';
import { extractFirstToolCall, parseToolArgumentsResult } from './fast-steward-response';
import { resolveFastStewardModel } from '@/lib/agents/control-plane/fast-model';

const getSummaryFastModel = () => getModelForSteward('SUMMARY_STEWARD_FAST_MODEL');

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
}): Promise<SummaryResult> {
  const { room, instruction, contextBundle, contextProfile } = params;
  const { model: CEREBRAS_MODEL } = await resolveFastStewardModel({
    steward: 'summary',
    stewardEnvVar: 'SUMMARY_STEWARD_FAST_MODEL',
    room,
    task: 'summary.fast',
  }).catch(() => ({ model: getSummaryFastModel() }));
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

  if (!isFastStewardReady()) {
    const fallbackSummary = transcriptLines.slice(0, 800) || 'Summary unavailable.';
    return { summary: fallbackSummary };
  }

  try {
    const client = getCerebrasClient();
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools: summaryTools,
      tool_choice: 'auto',
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name === 'commit_summary') {
      const argsResult = parseToolArgumentsResult(toolCall.argumentsRaw);
      if (!argsResult.ok) {
        console.warn('[SummaryStewardFast] Invalid tool arguments', { reason: argsResult.error });
        return { summary: transcriptLines.slice(0, 800) || 'Summary unavailable.' };
      }

      const args = argsResult.args;
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
