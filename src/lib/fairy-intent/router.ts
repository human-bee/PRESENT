import {
  getCerebrasClient,
  getModelForSteward,
  isFastStewardReady,
} from '@/lib/agents/fast-steward-config';
import {
  extractFirstToolCall,
  parseToolArgumentsResult,
} from '@/lib/agents/subagents/fast-steward-response';
import {
  recordModelIoEvent,
  recordToolIoEvent,
} from '@/lib/agents/shared/replay-telemetry';
import type { FairyIntent } from './intent';
import { FairyRouteDecisionSchema, type FairyRouteDecision, routerTools } from './router-schema';

const ROUTER_SYSTEM = [
  'You are a routing assistant for a realtime collaborative smartboard.',
  'Choose the best route for the user request with minimal latency and maximal correctness.',
  'Also select a contextProfile: glance (minimal), standard, deep (richer context), archive (full meeting sweep).',
  'Routes:',
  '- canvas: drawing, layout, styling, positioning, or edits to the tldraw canvas.',
  '- scorecard: debate scorecard creation or updates.',
  '- infographic: infographic widget requests.',
  '- kanban: linear kanban board requests.',
  '- crowd_pulse: crowd pulse hand count, Q&A tracking, or audience questions.',
  '- view: viewport/layout changes (zoom, focus, toggle grid, arrange grid/sidebar/speaker for tiles).',
  '- summary: create a CRM-ready summary document for future meetings.',
  '- bundle: multiple outputs; populate actions array with each desired output.',
  '- none: no action.',
  'When routing to scorecard/infographic/kanban, set componentType accordingly.',
  'When routing to crowd_pulse, set componentType to CrowdPulseWidget.',
  'When routing to view, set fastLaneEvent to one of: tldraw:canvas_focus, tldraw:canvas_zoom_all, tldraw:toggleGrid, tldraw:arrangeGrid, tldraw:arrangeSidebar, tldraw:arrangeSpeaker.',
  'Use tldraw:applyViewPreset for view presets like gallery/grid, speaker/spotlight, sidebar/filmstrip, presenter/screen-share, or canvas focus. Set fastLaneDetail.preset accordingly.',
  'Use tldraw:arrangeGrid for grid view of participant tiles (componentTypes: ["LivekitParticipantTile"]).',
  'Use tldraw:arrangeSidebar for sidebar view of participant tiles (componentTypes: ["LivekitParticipantTile"], side: "left"|"right").',
  'Use tldraw:arrangeSpeaker for speaker spotlight view (componentTypes: ["LivekitParticipantTile"], optional speakerIdentity or speakerComponentId, side for the sidebar).',
  'If the user wants to immediately correct a view, set fastLaneDetail.force = true to bypass cooldowns.',
  'For tldraw:canvas_focus, use fastLaneDetail.target = all|selected|shape|component and optional padding.',
  'If the request is ambiguous, prefer canvas with a concise imperative message.',
  'For bundle, include actions with kind, optional message, and contextProfile overrides per action.',
  'Use contextProfile = glance for pure view/layout tweaks; deep/archive for summaries, retrospectives, or multi-output requests.',
  'Return a single tool call to route_intent using the schema provided.',
].join(' ');

const ROUTER_MODEL = getModelForSteward('FAIRY_ROUTER_FAST_MODEL');
let fairyReplaySequence = 0;
const nextFairyReplaySequence = () => {
  fairyReplaySequence += 1;
  return fairyReplaySequence;
};

export async function routeFairyIntent(intent: FairyIntent): Promise<FairyRouteDecision> {
  const replayRequestId = intent.id;
  const replayTraceId = replayRequestId;
  const replayIntentId = replayRequestId;
  const replaySessionId = `fairy-router-${intent.room}`;

  if (!isFastStewardReady()) {
    recordModelIoEvent({
      source: 'fairy_router',
      eventType: 'model_skipped',
      status: 'fallback',
      sequence: nextFairyReplaySequence(),
      sessionId: replaySessionId,
      room: intent.room,
      requestId: replayRequestId,
      traceId: replayTraceId,
      intentId: replayIntentId,
      provider: 'cerebras',
      model: ROUTER_MODEL,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      systemPrompt: ROUTER_SYSTEM,
      input: intent,
      output: { kind: 'canvas', confidence: 0.2, reason: 'fast_steward_not_ready' },
    });
    return {
      kind: 'canvas',
      confidence: 0.2,
      message: intent.message,
    };
  }

  const client = getCerebrasClient();
  const contextBits: string[] = [];
  if (intent.selectionIds?.length) {
    contextBits.push(`selectionIds: ${intent.selectionIds.length}`);
  }
  if (intent.bounds) {
    contextBits.push(`bounds: (${intent.bounds.x},${intent.bounds.y},${intent.bounds.w},${intent.bounds.h})`);
  }
  if (intent.componentId) {
    contextBits.push(`componentId: ${intent.componentId}`);
  }
  if (intent.contextProfile) {
    contextBits.push(`contextProfile: ${intent.contextProfile}`);
  }
  const metadata = intent.metadata && typeof intent.metadata === 'object' && !Array.isArray(intent.metadata)
    ? (intent.metadata as Record<string, unknown>)
    : null;
  const promptSummary = metadata?.promptSummary as Record<string, unknown> | undefined;
  if (promptSummary) {
    const profile = typeof promptSummary.profile === 'string' ? promptSummary.profile : undefined;
    const widgets = typeof promptSummary.widgets === 'number' ? promptSummary.widgets : undefined;
    const documents = typeof promptSummary.documents === 'number' ? promptSummary.documents : undefined;
    if (profile || widgets != null || documents != null) {
      contextBits.push(
        `bundle: profile=${profile ?? 'n/a'} widgets=${widgets ?? 'n/a'} docs=${documents ?? 'n/a'}`,
      );
    }
  }
  const viewContext = metadata?.viewContext as Record<string, unknown> | undefined;
  if (viewContext && typeof viewContext === 'object') {
    const total = typeof viewContext.totalComponents === 'number' ? viewContext.totalComponents : undefined;
    const counts = viewContext.componentCounts && typeof viewContext.componentCounts === 'object'
      ? Object.entries(viewContext.componentCounts as Record<string, unknown>)
          .slice(0, 6)
          .map(([key, value]) => `${key}:${value}`)
          .join(', ')
      : '';
    if (total != null || counts) {
      contextBits.push(`viewContext: total=${total ?? 'n/a'} counts=${counts || 'n/a'}`);
    }
  }

  const messages = [
    { role: 'system' as const, content: ROUTER_SYSTEM },
    {
      role: 'user' as const,
      content: `Request: "${intent.message}"\nSource: ${intent.source}\nContext: ${contextBits.join(' | ') || 'none'}\nReturn route_intent.`,
    },
  ];
  recordModelIoEvent({
    source: 'fairy_router',
    eventType: 'model_call',
    status: 'started',
    sequence: nextFairyReplaySequence(),
    sessionId: replaySessionId,
    room: intent.room,
    requestId: replayRequestId,
    traceId: replayTraceId,
    intentId: replayIntentId,
    provider: 'cerebras',
    model: ROUTER_MODEL,
    providerSource: 'runtime_selected',
    providerPath: 'fast',
    systemPrompt: ROUTER_SYSTEM,
    contextPriming: {
      source: intent.source,
      contextBits,
      contextProfile: intent.contextProfile,
      selectionIds: intent.selectionIds?.length ?? 0,
      bounds: intent.bounds ?? null,
      componentId: intent.componentId ?? null,
    },
    input: messages,
  });

  try {
    const response = await client.chat.completions.create({
      model: ROUTER_MODEL,
      messages,
      tools: routerTools,
      tool_choice: 'auto',
    });
    recordModelIoEvent({
      source: 'fairy_router',
      eventType: 'model_call',
      status: 'completed',
      sequence: nextFairyReplaySequence(),
      sessionId: replaySessionId,
      room: intent.room,
      requestId: replayRequestId,
      traceId: replayTraceId,
      intentId: replayIntentId,
      provider: 'cerebras',
      model: ROUTER_MODEL,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      input: messages,
      output: response,
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name === 'route_intent') {
      recordToolIoEvent({
        source: 'fairy_router',
        eventType: 'tool_call',
        status: 'received',
        sequence: nextFairyReplaySequence(),
        sessionId: replaySessionId,
        room: intent.room,
        requestId: replayRequestId,
        traceId: replayTraceId,
        intentId: replayIntentId,
        toolName: toolCall.name,
        toolCallId: `${intent.id}:route_intent`,
        provider: 'cerebras',
        model: ROUTER_MODEL,
        providerSource: 'runtime_selected',
        providerPath: 'fast',
        input: {
          argumentsRaw: toolCall.argumentsRaw,
          name: toolCall.name,
        },
      });
      const parsedArgs = parseToolArgumentsResult(toolCall.argumentsRaw);
      if (!parsedArgs.ok) {
        console.warn('[FairyRouter] failed to parse route_intent arguments', {
          error: parsedArgs.error,
          rawLength: parsedArgs.raw.length,
          rawPreview: parsedArgs.raw.slice(0, 240),
        });
        recordToolIoEvent({
          source: 'fairy_router',
          eventType: 'tool_call',
          status: 'error',
          sequence: nextFairyReplaySequence(),
          sessionId: replaySessionId,
          room: intent.room,
          requestId: replayRequestId,
          traceId: replayTraceId,
          intentId: replayIntentId,
          toolName: toolCall.name,
          toolCallId: `${intent.id}:route_intent`,
          provider: 'cerebras',
          model: ROUTER_MODEL,
          providerSource: 'runtime_selected',
          providerPath: 'fast',
          input: {
            argumentsRaw: toolCall.argumentsRaw,
          },
          error: parsedArgs.error,
          priority: 'high',
        });
      }
      const args = parsedArgs.ok ? parsedArgs.args : {};
      const parsed = FairyRouteDecisionSchema.safeParse(args);
      if (parsed.success) {
        recordToolIoEvent({
          source: 'fairy_router',
          eventType: 'tool_call',
          status: 'completed',
          sequence: nextFairyReplaySequence(),
          sessionId: replaySessionId,
          room: intent.room,
          requestId: replayRequestId,
          traceId: replayTraceId,
          intentId: replayIntentId,
          toolName: toolCall.name,
          toolCallId: `${intent.id}:route_intent`,
          provider: 'cerebras',
          model: ROUTER_MODEL,
          providerSource: 'runtime_selected',
          providerPath: 'fast',
          input: args,
          output: parsed.data,
        });
        return parsed.data;
      }
      console.warn('[FairyRouter] route_intent payload failed schema validation', {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
      recordToolIoEvent({
        source: 'fairy_router',
        eventType: 'tool_call',
        status: 'error',
        sequence: nextFairyReplaySequence(),
        sessionId: replaySessionId,
        room: intent.room,
        requestId: replayRequestId,
        traceId: replayTraceId,
        intentId: replayIntentId,
        toolName: toolCall.name,
        toolCallId: `${intent.id}:route_intent`,
        provider: 'cerebras',
        model: ROUTER_MODEL,
        providerSource: 'runtime_selected',
        providerPath: 'fast',
        input: args,
        error: parsed.error.issues.map((issue) => issue.message).join('; '),
        priority: 'high',
      });
    }
  } catch (error) {
    console.warn('[FairyRouter] routing failed, falling back to canvas', error);
    recordModelIoEvent({
      source: 'fairy_router',
      eventType: 'model_call',
      status: 'error',
      sequence: nextFairyReplaySequence(),
      sessionId: replaySessionId,
      room: intent.room,
      requestId: replayRequestId,
      traceId: replayTraceId,
      intentId: replayIntentId,
      provider: 'cerebras',
      model: ROUTER_MODEL,
      providerSource: 'runtime_selected',
      providerPath: 'fast',
      input: messages,
      error: error instanceof Error ? error.message : String(error),
      priority: 'high',
    });
  }

  recordModelIoEvent({
    source: 'fairy_router',
    eventType: 'model_fallback',
    status: 'fallback',
    sequence: nextFairyReplaySequence(),
    sessionId: replaySessionId,
    room: intent.room,
    requestId: replayRequestId,
    traceId: replayTraceId,
    intentId: replayIntentId,
    provider: 'cerebras',
    model: ROUTER_MODEL,
    providerSource: 'runtime_selected',
    providerPath: 'fast',
    input: intent,
    output: { kind: 'canvas', confidence: 0.2, message: intent.message },
  });
  return {
    kind: 'canvas',
    confidence: 0.2,
    message: intent.message,
  };
}
