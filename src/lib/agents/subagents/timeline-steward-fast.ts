import { getCerebrasClient, getModelForSteward, isFastStewardReady } from '../fast-steward-config';
import {
  formatContextDocuments,
  getContextDocuments,
  getTranscriptWindow,
} from '@/lib/agents/shared/supabase-context';
import {
  createDefaultTimelineDocument,
  type TimelineDependency,
  type TimelineItem,
  type TimelineLane,
  type TimelineOp,
  type TimelineSourceEvent,
} from '@/lib/agents/timeline-schema';
import { extractFirstToolCall, parseToolArgumentsResult } from './fast-steward-response';
import { resolveFastStewardModel } from '@/lib/agents/control-plane/fast-model';
import { recordModelIoEvent, recordToolIoEvent } from '@/lib/agents/shared/replay-telemetry';

const getTimelineFastModel = () => getModelForSteward('TIMELINE_STEWARD_FAST_MODEL');
let timelineReplaySequence = 0;
const nextTimelineReplaySequence = () => {
  timelineReplaySequence += 1;
  return timelineReplaySequence;
};

const TIMELINE_SYSTEM = `
You are a fast timeline steward for a realtime collaborative workspace.
Goal: convert a roadmap, sprint planning, or dependency-management request into a lightweight timeline model.
Keep output sparse and practical. Prefer 2-5 lanes, 2-8 items, and only explicit dependencies.
Never mention debate or scorecards. Return a single commit_timeline_plan tool call.
`;

const timelineTools = [
  {
    type: 'function' as const,
    function: {
      name: 'commit_timeline_plan',
      description: 'Return a structured roadmap plan for the timeline widget',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          horizonLabel: { type: 'string' },
          lanes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                kind: { type: 'string', enum: ['team', 'workstream', 'horizon'] },
                order: { type: 'number' },
                color: { type: 'string' },
                owner: { type: 'string' },
              },
              required: ['id', 'name'],
              additionalProperties: false,
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                laneId: { type: 'string' },
                title: { type: 'string' },
                type: { type: 'string', enum: ['milestone', 'task', 'sprint', 'decision', 'blocker', 'handoff'] },
                status: { type: 'string', enum: ['planned', 'in_progress', 'blocked', 'at_risk', 'done'] },
                owner: { type: 'string' },
                summary: { type: 'string' },
                notes: { type: 'string' },
                sprintLabel: { type: 'string' },
                startLabel: { type: 'string' },
                dueLabel: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                blockedBy: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'laneId', 'title'],
              additionalProperties: false,
            },
          },
          dependencies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                fromItemId: { type: 'string' },
                toItemId: { type: 'string' },
                kind: { type: 'string', enum: ['blocks', 'depends_on', 'handoff'] },
                label: { type: 'string' },
              },
              required: ['id', 'fromItemId', 'toItemId'],
              additionalProperties: false,
            },
          },
          exportTarget: { type: 'string', enum: ['linear', 'trello', 'asana', 'manual'] },
          exportSummary: { type: 'string' },
        },
        required: [],
      },
    },
  },
];

type TimelineStewardResult = {
  ops: TimelineOp[];
  summary: string;
};

const resolveWindowMs = (profile?: string) => {
  if (profile === 'glance') return 25_000;
  if (profile === 'deep') return 210_000;
  if (profile === 'archive') return 540_000;
  return 120_000;
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';

const formatExistingTimelineDocument = (
  document?: {
    title?: string;
    subtitle?: string;
    horizonLabel?: string;
    lanes?: Array<{ id?: string; name?: string; kind?: string; owner?: string }>;
    items?: Array<{
      id?: string;
      laneId?: string;
      title?: string;
      type?: string;
      status?: string;
      owner?: string;
      blockedBy?: string[];
    }>;
    dependencies?: Array<{ id?: string; fromItemId?: string; toItemId?: string; kind?: string; label?: string }>;
  },
) => {
  if (!document) return '';
  const lanes = Array.isArray(document.lanes) ? document.lanes.slice(0, 8) : [];
  const items = Array.isArray(document.items) ? document.items.slice(0, 20) : [];
  const dependencies = Array.isArray(document.dependencies) ? document.dependencies.slice(0, 20) : [];
  if (lanes.length === 0 && items.length === 0 && dependencies.length === 0) return '';
  return [
    `Current Timeline Title: ${document.title || 'Untitled'}`,
    document.subtitle ? `Current Timeline Subtitle: ${document.subtitle}` : '',
    document.horizonLabel ? `Current Horizon: ${document.horizonLabel}` : '',
    lanes.length > 0
      ? `Existing Lanes:\n${lanes
          .map((lane) => `- ${lane.id || 'lane'} | ${lane.name || 'Unnamed'} | ${lane.kind || 'team'}${lane.owner ? ` | owner=${lane.owner}` : ''}`)
          .join('\n')}`
      : '',
    items.length > 0
      ? `Existing Items:\n${items
          .map(
            (item) =>
              `- ${item.id || 'item'} | lane=${item.laneId || 'unknown'} | ${item.title || 'Untitled'} | ${item.type || 'task'} | ${item.status || 'planned'}${item.owner ? ` | owner=${item.owner}` : ''}${Array.isArray(item.blockedBy) && item.blockedBy.length > 0 ? ` | blockedBy=${item.blockedBy.join(',')}` : ''}`,
          )
          .join('\n')}`
      : '',
    dependencies.length > 0
      ? `Existing Dependencies:\n${dependencies
          .map(
            (dependency) =>
              `- ${dependency.id || 'dep'} | ${dependency.fromItemId || 'from'} -> ${dependency.toItemId || 'to'} | ${dependency.kind || 'blocks'}${dependency.label ? ` | ${dependency.label}` : ''}`,
          )
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

const buildFallbackPlan = (
  componentId: string,
  instruction: string,
  options?: {
    source?: 'voice' | 'webhook' | 'form' | 'tool' | 'manual' | 'system';
    title?: string;
    subtitle?: string;
    horizonLabel?: string;
    document?: {
      lanes?: TimelineLane[];
    };
  },
): TimelineStewardResult => {
  const now = Date.now();
  const seed = createDefaultTimelineDocument(componentId);
  const lower = instruction.toLowerCase();
  const existingLanes =
    Array.isArray(options?.document?.lanes) && options.document.lanes.length > 0
      ? options.document.lanes
      : [];
  const laneSeeds = [
    lower.includes('product') ? { id: 'lane-product', name: 'Product', kind: 'team', order: 0, color: '#79b8ff' } : null,
    /(engineering|backend|frontend|platform)/.test(lower)
      ? { id: 'lane-engineering', name: 'Engineering', kind: 'team', order: 1, color: '#4fd39f' }
      : null,
    /(design|brand|ux)/.test(lower)
      ? { id: 'lane-design', name: 'Design', kind: 'team', order: 2, color: '#f29fb7' }
      : null,
    /(marketing|launch|go to market|sales)/.test(lower)
      ? { id: 'lane-go-to-market', name: 'Go To Market', kind: 'team', order: 3, color: '#f6b756' }
      : null,
  ].filter(Boolean) as TimelineLane[];
  const lanes = existingLanes.length > 0 ? existingLanes : laneSeeds.length > 0 ? laneSeeds : seed.lanes;
  const leadLane = lanes[0];
  const followLane = lanes[1] ?? lanes[0];
  const leadItemId = `item-${slugify(instruction.split(/[.!?\n]/)[0] ?? 'timeline-kickoff')}`;
  const blockerItemId = `${leadItemId}-blocker`;
  const items: TimelineItem[] = [
    {
      id: leadItemId,
      laneId: leadLane.id,
      title: lower.includes('sprint') ? 'Current sprint alignment' : 'Roadmap kickoff',
      type: lower.includes('sprint') ? 'sprint' : 'milestone',
      status: 'in_progress',
      summary: instruction.trim().slice(0, 180),
      notes: 'Initial scaffold from timeline steward fallback.',
      tags: lower.includes('roadmap') ? ['roadmap'] : ['planning'],
      blockedBy: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
  const dependencies: TimelineDependency[] = [];
  if (lanes.length > 1 || /blocker|dependency|depends on|handoff/.test(lower)) {
    items.push({
      id: blockerItemId,
      laneId: followLane.id,
      title: /blocker|risk/.test(lower) ? 'Open dependency risk' : 'Cross-team handoff',
      type: /blocker|risk/.test(lower) ? 'blocker' : 'handoff',
      status: /blocker|risk/.test(lower) ? 'blocked' : 'planned',
      summary: 'Keep the next upstream dependency visible in the roadmap.',
      tags: ['dependency'],
      blockedBy: [],
      createdAt: now,
      updatedAt: now,
    });
    dependencies.push({
      id: `dep-${leadItemId}-${blockerItemId}`,
      fromItemId: blockerItemId,
      toItemId: leadItemId,
      kind: /handoff/.test(lower) ? 'handoff' : 'blocks',
      label: /handoff/.test(lower) ? 'handoff' : 'dependency',
    });
  }
  const sourceEvent: TimelineSourceEvent = {
    id: `evt-${now}`,
    source: options?.source ?? 'voice',
    summary: instruction.trim().slice(0, 200),
    createdAt: now,
  };
  return {
    ops: [
      {
        type: 'set_meta',
        title: options?.title?.trim() || 'Live Roadmap',
        subtitle:
          options?.subtitle?.trim() ||
          'Realtime planning surface for teams, risks, and milestones.',
        horizonLabel: options?.horizonLabel?.trim() || 'Active planning horizon',
      },
      ...lanes.map((lane) => ({ type: 'upsert_lane', lane }) satisfies TimelineOp),
      ...items.map((item) => ({ type: 'upsert_item', item }) satisfies TimelineOp),
      ...dependencies.map((dependency) => ({ type: 'set_dependency', dependency }) satisfies TimelineOp),
      { type: 'append_event', event: sourceEvent },
    ],
    summary: instruction.trim().slice(0, 180) || 'Timeline scaffold updated.',
  };
};

export async function runTimelineStewardFast(params: {
  room: string;
  componentId: string;
  instruction?: string;
  contextBundle?: string;
  contextProfile?: string;
  source?: 'voice' | 'webhook' | 'form' | 'tool' | 'manual' | 'system';
  document?: TimelineDocument;
  title?: string;
  subtitle?: string;
  horizonLabel?: string;
  requestId?: string;
  traceId?: string;
  intentId?: string;
  idempotencyKey?: string;
}): Promise<TimelineStewardResult> {
  const { room, componentId, instruction, contextBundle, contextProfile } = params;
  const prompt = instruction?.trim() || 'Create a lightweight roadmap timeline.';
  const { model } = await resolveFastStewardModel({
    steward: 'timeline',
    stewardEnvVar: 'TIMELINE_STEWARD_FAST_MODEL',
    room,
    task: 'timeline.fast',
  }).catch(() => ({ model: getTimelineFastModel() }));
  const requestId = params.requestId?.trim() || `timeline:${room}:${Date.now()}`;
  const traceId = params.traceId?.trim() || requestId;
  const intentId = params.intentId?.trim() || requestId;
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
  const existingTimelineSection = formatExistingTimelineDocument(params.document);
  const messages = [
    { role: 'system' as const, content: TIMELINE_SYSTEM },
    {
      role: 'user' as const,
      content: [
        `Instruction: ${prompt}`,
        existingTimelineSection ? `Current Timeline:\n${existingTimelineSection}` : '',
        contextBundle ? `Context Bundle:\n${contextBundle}` : '',
        contextSection ? `Context Documents:\n${contextSection}` : '',
        transcriptLines ? `Transcript:\n${transcriptLines}` : '',
        'Return commit_timeline_plan.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  recordModelIoEvent({
    source: 'fast_timeline_steward',
    eventType: 'model_call',
    status: 'started',
    sequence: nextTimelineReplaySequence(),
    sessionId: `fast-timeline-${room}`,
    room,
    requestId,
    traceId,
    intentId,
    provider: 'cerebras',
    model,
    providerSource: 'runtime_selected',
    providerPath: 'fast',
    systemPrompt: TIMELINE_SYSTEM,
    input: messages,
  });

  if (!isFastStewardReady()) {
    const fallback = buildFallbackPlan(componentId, prompt, {
      source: params.source,
      title: params.title,
      subtitle: params.subtitle,
      horizonLabel: params.horizonLabel,
      document: params.document,
    });
    recordModelIoEvent({
      source: 'fast_timeline_steward',
      eventType: 'model_call',
      status: 'fallback',
      sequence: nextTimelineReplaySequence(),
      sessionId: `fast-timeline-${room}`,
      room,
      requestId,
      traceId,
      intentId,
      provider: 'cerebras',
      model,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      output: { reason: 'fast_steward_not_ready', fallback },
    });
    return fallback;
  }

  try {
    const client = getCerebrasClient();
    const response = await client.chat.completions.create({
      model,
      messages,
      tools: timelineTools,
      tool_choice: 'auto',
    });
    recordModelIoEvent({
      source: 'fast_timeline_steward',
      eventType: 'model_call',
      status: 'completed',
      sequence: nextTimelineReplaySequence(),
      sessionId: `fast-timeline-${room}`,
      room,
      requestId,
      traceId,
      intentId,
      provider: 'cerebras',
      model,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      input: messages,
      output: response,
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name !== 'commit_timeline_plan') {
      return buildFallbackPlan(componentId, prompt, {
        source: params.source,
        title: params.title,
        subtitle: params.subtitle,
        horizonLabel: params.horizonLabel,
        document: params.document,
      });
    }

    recordToolIoEvent({
      source: 'fast_timeline_steward',
      eventType: 'tool_call',
      status: 'received',
      sequence: nextTimelineReplaySequence(),
      sessionId: `fast-timeline-${room}`,
      room,
      requestId,
      traceId,
      intentId,
      toolName: toolCall.name,
      toolCallId: `${requestId}:commit_timeline_plan`,
      provider: 'cerebras',
      model,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      input: { argumentsRaw: toolCall.argumentsRaw },
    });
    const argsResult = parseToolArgumentsResult(toolCall.argumentsRaw);
    if (!argsResult.ok) {
      return buildFallbackPlan(componentId, prompt, {
        source: params.source,
        title: params.title,
        subtitle: params.subtitle,
        horizonLabel: params.horizonLabel,
        document: params.document,
      });
    }

    const now = Date.now();
    const args = argsResult.args as Record<string, unknown>;
    const lanes = Array.isArray(args.lanes) ? (args.lanes as TimelineLane[]) : [];
    const items = Array.isArray(args.items) ? (args.items as TimelineItem[]) : [];
    const dependencies = Array.isArray(args.dependencies) ? (args.dependencies as TimelineDependency[]) : [];
    const ops: TimelineOp[] = [
      {
        type: 'set_meta',
        title:
          typeof args.title === 'string' && args.title.trim().length > 0
            ? args.title.trim()
            : params.title?.trim() || 'Live Roadmap',
        subtitle:
          typeof args.subtitle === 'string' && args.subtitle.trim().length > 0
            ? args.subtitle.trim()
            : params.subtitle?.trim() || 'Realtime planning surface for teams, risks, and milestones.',
        horizonLabel:
          typeof args.horizonLabel === 'string' && args.horizonLabel.trim().length > 0
            ? args.horizonLabel.trim()
            : params.horizonLabel?.trim() || 'Active planning horizon',
      },
      ...lanes.map((lane, index) => ({
        type: 'upsert_lane',
        lane: {
          ...lane,
          id: lane.id || `lane-${slugify(lane.name || `lane-${index + 1}`)}`,
          name: lane.name || `Lane ${index + 1}`,
          order: typeof lane.order === 'number' ? lane.order : index,
        },
      })),
      ...items.map((item, index) => ({
        type: 'upsert_item',
        item: {
          ...item,
          id: item.id || `item-${index + 1}`,
          laneId: item.laneId || lanes[0]?.id || 'lane-product',
          title: item.title || `Milestone ${index + 1}`,
          tags: Array.isArray(item.tags) ? item.tags : [],
          blockedBy: Array.isArray(item.blockedBy) ? item.blockedBy : [],
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
          updatedAt: now,
        },
      })),
      ...dependencies.map((dependency, index) => ({
        type: 'set_dependency',
        dependency: {
          ...dependency,
          id: dependency.id || `dep-${index + 1}`,
        },
      })),
      {
        type: 'append_event',
        event: {
          id: `evt-${now}`,
          source: params.source ?? 'voice',
          requestId,
          traceId,
          intentId,
          idempotencyKey: params.idempotencyKey,
          summary: prompt.slice(0, 200),
          createdAt: now,
        },
      },
      ...(typeof args.exportTarget === 'string'
        ? [{
            type: 'stage_export' as const,
            exportStage: {
              id: `export-${String(args.exportTarget)}`,
              target: args.exportTarget as 'linear' | 'trello' | 'asana' | 'manual',
              status: 'pending',
              summary:
                typeof args.exportSummary === 'string' && args.exportSummary.trim().length > 0
                  ? args.exportSummary.trim()
                  : 'Export staged from timeline steward.',
              queuedAt: now,
              updatedAt: now,
            },
          }]
        : []),
    ];
    return {
      ops,
      summary: prompt.slice(0, 180),
    };
  } catch {
    return buildFallbackPlan(componentId, prompt, {
      source: params.source,
      title: params.title,
      subtitle: params.subtitle,
      horizonLabel: params.horizonLabel,
      document: params.document,
    });
  }
}
