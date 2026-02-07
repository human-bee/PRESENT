import {
  getCerebrasClient,
  getModelForSteward,
  isFastStewardReady,
} from '../fast-steward-config';
import {
  getContextDocuments,
  getTranscriptWindow,
  formatContextDocuments,
} from '@/lib/agents/shared/supabase-context';
import { BYOK_REQUIRED } from '@/lib/agents/shared/byok-flags';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

const CEREBRAS_MODEL = getModelForSteward('CROWD_PULSE_STEWARD_FAST_MODEL');

const CROWD_PULSE_SYSTEM = `
You are a fast crowd pulse steward for a realtime collaborative workspace.
Goal: interpret a request and produce a minimal patch for the CrowdPulseWidget.
Only include fields that are explicitly supported or implied by the request or context.
Never invent counts; if numbers are missing, omit those fields.
Return a single commit_crowd_pulse tool call.
`;

const crowdPulseTools = [
  {
    type: 'function' as const,
    function: {
      name: 'commit_crowd_pulse',
      description: 'Return a structured patch for CrowdPulseWidget',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          prompt: { type: 'string' },
          status: { type: 'string', enum: ['idle', 'counting', 'locked'] },
          handCount: { type: 'number' },
          peakCount: { type: 'number' },
          confidence: { type: 'number' },
          noiseLevel: { type: 'number' },
          activeQuestion: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                votes: { type: 'number' },
                status: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                speaker: { type: 'string' },
              },
              required: ['id', 'text'],
              additionalProperties: false,
            },
          },
          scoreboard: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                score: { type: 'number' },
                delta: { type: 'number' },
              },
              required: ['label', 'score'],
              additionalProperties: false,
            },
          },
          followUps: { type: 'array', items: { type: 'string' } },
        },
        required: [],
      },
    },
  },
];

export type CrowdPulsePatch = {
  title?: string;
  prompt?: string;
  status?: 'idle' | 'counting' | 'locked';
  handCount?: number;
  peakCount?: number;
  confidence?: number;
  noiseLevel?: number;
  activeQuestion?: string;
  questions?: Array<{
    id: string;
    text: string;
    votes?: number;
    status?: string;
    tags?: string[];
    speaker?: string;
  }>;
  scoreboard?: Array<{ label: string; score: number; delta?: number }>;
  followUps?: string[];
};

const resolveWindowMs = (profile?: string) => {
  if (profile === 'glance') return 20_000;
  if (profile === 'deep') return 180_000;
  if (profile === 'archive') return 420_000;
  return 90_000;
};

export async function runCrowdPulseStewardFast(params: {
  room: string;
  instruction?: string;
  contextBundle?: string;
  contextProfile?: string;
  billingUserId?: string;
}): Promise<CrowdPulsePatch> {
  const { room, instruction, contextBundle, contextProfile, billingUserId } = params;
  const [transcript, contextDocs] = await Promise.all([
    getTranscriptWindow(room, resolveWindowMs(contextProfile)),
    getContextDocuments(room),
  ]);
  const transcriptLines = Array.isArray(transcript?.transcript)
    ? transcript.transcript
        .filter((entry) => entry && typeof entry.text === 'string')
        .slice(-60)
        .map((entry) => `${entry.participantId || 'Speaker'}: ${entry.text}`)
        .join('\n')
    : '';
  const contextSection = contextDocs.length > 0 ? formatContextDocuments(contextDocs) : '';

  const messages = [
    { role: 'system' as const, content: CROWD_PULSE_SYSTEM },
    {
      role: 'user' as const,
      content: [
        instruction ? `Instruction: ${instruction}` : '',
        contextBundle ? `Context Bundle:\n${contextBundle}` : '',
        contextSection ? `Context Documents:\n${contextSection}` : '',
        transcriptLines ? `Transcript:\n${transcriptLines}` : '',
        'Return commit_crowd_pulse.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  const cerebrasKey = BYOK_REQUIRED && billingUserId
    ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
    : null;

  if (BYOK_REQUIRED && !cerebrasKey) {
    return instruction ? { prompt: instruction.slice(0, 180) } : {};
  }

  if (!BYOK_REQUIRED && !isFastStewardReady()) {
    return instruction ? { prompt: instruction.slice(0, 180) } : {};
  }

  try {
    const client = getCerebrasClient(cerebrasKey ?? undefined);
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools: crowdPulseTools,
      tool_choice: 'auto',
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name === 'commit_crowd_pulse') {
      const argsResult = parseToolArgumentsResult(toolCall.argumentsRaw);
      if (!argsResult.ok) {
        console.warn('[CrowdPulseStewardFast] Invalid tool arguments', { reason: argsResult.error });
        return instruction ? { prompt: instruction.slice(0, 180) } : {};
      }
      const args = argsResult.args;
      const patch: CrowdPulsePatch = {};
      if (typeof args.title === 'string') patch.title = args.title.trim();
      if (typeof args.prompt === 'string') patch.prompt = args.prompt.trim();
      if (typeof args.status === 'string') {
        const status = args.status;
        if (status === 'idle' || status === 'counting' || status === 'locked') {
          patch.status = status;
        }
      }
      if (typeof args.handCount === 'number') patch.handCount = args.handCount;
      if (typeof args.peakCount === 'number') patch.peakCount = args.peakCount;
      if (typeof args.confidence === 'number') patch.confidence = args.confidence;
      if (typeof args.noiseLevel === 'number') patch.noiseLevel = args.noiseLevel;
      if (typeof args.activeQuestion === 'string') patch.activeQuestion = args.activeQuestion.trim();
      if (Array.isArray(args.questions)) patch.questions = args.questions;
      if (Array.isArray(args.scoreboard)) patch.scoreboard = args.scoreboard;
      if (Array.isArray(args.followUps)) patch.followUps = args.followUps;
      return patch;
    }
  } catch (error) {
    console.error('[CrowdPulseStewardFast] Error:', error);
  }

  return instruction ? { prompt: instruction.slice(0, 180) } : {};
}
