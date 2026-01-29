import {
  getCerebrasClient,
  getModelForSteward,
  isFastStewardReady,
} from '@/lib/agents/fast-steward-config';
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
  '- view: viewport/layout changes (zoom, focus, toggle grid, arrange grid/sidebar/speaker for tiles).',
  '- summary: create a CRM-ready summary document for future meetings.',
  '- bundle: multiple outputs; populate actions array with each desired output.',
  '- none: no action.',
  'When routing to scorecard/infographic/kanban, set componentType accordingly.',
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

export async function routeFairyIntent(intent: FairyIntent): Promise<FairyRouteDecision> {
  if (!isFastStewardReady()) {
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

  try {
    const response = await client.chat.completions.create({
      model: ROUTER_MODEL,
      messages,
      tools: routerTools,
      tool_choice: 'auto',
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name === 'route_intent') {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      const parsed = FairyRouteDecisionSchema.safeParse(args);
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch (error) {
    console.warn('[FairyRouter] routing failed, falling back to canvas', error);
  }

  return {
    kind: 'canvas',
    confidence: 0.2,
    message: intent.message,
  };
}
