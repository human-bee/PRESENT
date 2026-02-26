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
import { extractFirstToolCall, parseToolArgumentsResult } from './fast-steward-response';
import {
  normalizeCrowdPulseStatus,
  normalizeCrowdPulseActiveQuestionInput,
  parseCrowdPulseFallbackInstruction,
  type CrowdPulsePatch,
} from './crowd-pulse-parser';
import { resolveFastStewardModel } from '@/lib/agents/control-plane/fast-model';
import {
  recordModelIoEvent,
  recordToolIoEvent,
} from '@/lib/agents/shared/replay-telemetry';

const getCrowdPulseFastModel = () => getModelForSteward('CROWD_PULSE_STEWARD_FAST_MODEL');
let crowdPulseReplaySequence = 0;
const nextCrowdPulseReplaySequence = () => {
  crowdPulseReplaySequence += 1;
  return crowdPulseReplaySequence;
};

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
          status: { type: 'string', enum: ['idle', 'counting', 'locked', 'q_and_a'] },
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
}): Promise<CrowdPulsePatch> {
  const { room, instruction, contextBundle, contextProfile } = params;
  const { model: CEREBRAS_MODEL } = await resolveFastStewardModel({
    steward: 'crowd_pulse',
    stewardEnvVar: 'CROWD_PULSE_STEWARD_FAST_MODEL',
    room,
    task: 'crowd_pulse.fast',
  }).catch(() => ({ model: getCrowdPulseFastModel() }));
  const requestId = `crowd-pulse:${room}:${Date.now()}`;
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
  recordModelIoEvent({
    source: 'fast_crowd_pulse_steward',
    eventType: 'model_call',
    status: 'started',
    sequence: nextCrowdPulseReplaySequence(),
    sessionId: `fast-crowd-pulse-${room}`,
    room,
    requestId,
    traceId: requestId,
    intentId: requestId,
    provider: 'cerebras',
    model: CEREBRAS_MODEL,
    providerSource: 'runtime_selected',
    providerPath: 'fast',
    systemPrompt: CROWD_PULSE_SYSTEM,
    input: messages,
    contextPriming: {
      contextProfile: contextProfile ?? 'standard',
      hasContextBundle: Boolean(contextBundle),
      transcriptLines: transcriptLines.length,
      contextDocs: contextDocs.length,
    },
  });

  if (!isFastStewardReady()) {
    const fallback = parseCrowdPulseFallbackInstruction(instruction);
    recordModelIoEvent({
      source: 'fast_crowd_pulse_steward',
      eventType: 'model_call',
      status: 'fallback',
      sequence: nextCrowdPulseReplaySequence(),
      sessionId: `fast-crowd-pulse-${room}`,
      room,
      requestId,
      traceId: requestId,
      intentId: requestId,
      provider: 'cerebras',
      model: CEREBRAS_MODEL,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      output: { reason: 'fast_steward_not_ready', fallback },
    });
    return fallback;
  }

  try {
    const client = getCerebrasClient();
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools: crowdPulseTools,
      tool_choice: 'auto',
    });
    recordModelIoEvent({
      source: 'fast_crowd_pulse_steward',
      eventType: 'model_call',
      status: 'completed',
      sequence: nextCrowdPulseReplaySequence(),
      sessionId: `fast-crowd-pulse-${room}`,
      room,
      requestId,
      traceId: requestId,
      intentId: requestId,
      provider: 'cerebras',
      model: CEREBRAS_MODEL,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      input: messages,
      output: response,
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name === 'commit_crowd_pulse') {
      recordToolIoEvent({
        source: 'fast_crowd_pulse_steward',
        eventType: 'tool_call',
        status: 'received',
        sequence: nextCrowdPulseReplaySequence(),
        sessionId: `fast-crowd-pulse-${room}`,
        room,
        requestId,
        traceId: requestId,
        intentId: requestId,
        toolName: toolCall.name,
        toolCallId: `${requestId}:commit_crowd_pulse`,
        provider: 'cerebras',
        model: CEREBRAS_MODEL,
        providerSource: 'runtime_selected',
        providerPath: 'fast',
        input: { argumentsRaw: toolCall.argumentsRaw },
      });
      const argsResult = parseToolArgumentsResult(toolCall.argumentsRaw);
      if (!argsResult.ok) {
        console.warn('[CrowdPulseStewardFast] Invalid tool arguments', { reason: argsResult.error });
        recordToolIoEvent({
          source: 'fast_crowd_pulse_steward',
          eventType: 'tool_call',
          status: 'error',
          sequence: nextCrowdPulseReplaySequence(),
          sessionId: `fast-crowd-pulse-${room}`,
          room,
          requestId,
          traceId: requestId,
          intentId: requestId,
          toolName: toolCall.name,
          toolCallId: `${requestId}:commit_crowd_pulse`,
          provider: 'cerebras',
          model: CEREBRAS_MODEL,
          providerSource: 'runtime_selected',
          providerPath: 'fast',
          input: { argumentsRaw: toolCall.argumentsRaw },
          error: argsResult.error,
          priority: 'high',
        });
        return parseCrowdPulseFallbackInstruction(instruction);
      }
      const args = argsResult.args;
      const patch: CrowdPulsePatch = {};
      if (typeof args.title === 'string') patch.title = args.title.trim();
      if (typeof args.prompt === 'string') patch.prompt = args.prompt.trim();
      const parsedStatus = normalizeCrowdPulseStatus(args.status);
      if (parsedStatus) {
        patch.status = parsedStatus;
      }
      if (typeof args.handCount === 'number') patch.handCount = args.handCount;
      if (typeof args.peakCount === 'number') patch.peakCount = args.peakCount;
      if (typeof args.confidence === 'number') patch.confidence = args.confidence;
      if (typeof args.noiseLevel === 'number') patch.noiseLevel = args.noiseLevel;
      const normalizedActiveQuestion = normalizeCrowdPulseActiveQuestionInput(
        args.activeQuestion,
        instruction,
      );
      if (typeof normalizedActiveQuestion === 'string') {
        patch.activeQuestion = normalizedActiveQuestion;
      }
      if (Array.isArray(args.questions)) patch.questions = args.questions;
      if (Array.isArray(args.scoreboard)) patch.scoreboard = args.scoreboard;
      if (Array.isArray(args.followUps)) patch.followUps = args.followUps;
      const resolvedPatch = Object.keys(patch).length > 0 ? patch : parseCrowdPulseFallbackInstruction(instruction);
      recordToolIoEvent({
        source: 'fast_crowd_pulse_steward',
        eventType: 'tool_call',
        status: 'completed',
        sequence: nextCrowdPulseReplaySequence(),
        sessionId: `fast-crowd-pulse-${room}`,
        room,
        requestId,
        traceId: requestId,
        intentId: requestId,
        toolName: toolCall.name,
        toolCallId: `${requestId}:commit_crowd_pulse`,
        provider: 'cerebras',
        model: CEREBRAS_MODEL,
        providerSource: 'runtime_selected',
        providerPath: 'fast',
        input: args,
        output: resolvedPatch,
      });
      return resolvedPatch;
    }
  } catch (error) {
    console.error('[CrowdPulseStewardFast] Error:', error);
    recordModelIoEvent({
      source: 'fast_crowd_pulse_steward',
      eventType: 'model_call',
      status: 'error',
      sequence: nextCrowdPulseReplaySequence(),
      sessionId: `fast-crowd-pulse-${room}`,
      room,
      requestId,
      traceId: requestId,
      intentId: requestId,
      provider: 'cerebras',
      model: CEREBRAS_MODEL,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      input: messages,
      error: error instanceof Error ? error.message : String(error),
      priority: 'high',
    });
  }

  return parseCrowdPulseFallbackInstruction(instruction);
}
