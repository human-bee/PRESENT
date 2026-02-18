import { run } from '@openai/agents';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jsonObjectSchema, type JsonObject } from '@/lib/utils/json-schema';
import {
  broadcastAgentPrompt,
  broadcastToolCall,
  commitDebateScorecard,
  getDebateScorecard,
  listCanvasComponents,
  type CanvasAgentPromptPayload,
} from '@/lib/agents/shared/supabase-context';
import { activeFlowchartSteward } from '../subagents/flowchart-steward-registry';
import { runCanvasSteward } from '../subagents/canvas-steward';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { resolveIntent, getObject, getString } from './intent-resolver';
import { runDebateScorecardSteward, seedScorecardState } from '@/lib/agents/debate-judge';
import { runDebateScorecardStewardFast } from '@/lib/agents/subagents/debate-steward-fast';
import { isFastStewardReady } from '@/lib/agents/fast-steward-config';
import {
  createDefaultPlayers,
  debateSideEnum,
  debateSpeechEnum,
  claimStatusEnum,
  verdictEnum,
  impactEnum,
  debateScorecardStateSchema,
  type DebateScorecardState,
  type Claim,
} from '@/lib/agents/debate-scorecard-schema';
import { runSearchSteward } from '@/lib/agents/subagents/search-steward';
import {
  FairyIntentSchema,
  normalizeFairyIntent,
  routeFairyIntent,
  type FairyIntent,
  type FairyRouteDecision,
} from '@/lib/fairy-intent';
import {
  DEFAULT_FAIRY_CONTEXT_PROFILE,
  getFairyContextSpectrum,
  normalizeFairyContextProfile,
  resolveProfileFromSpectrum,
  type FairyContextProfile,
} from '@/lib/fairy-context/profiles';
import { formatFairyContextParts } from '@/lib/fairy-context/format';
import { runSummaryStewardFast } from '@/lib/agents/subagents/summary-steward-fast';
import { runCrowdPulseStewardFast } from '@/lib/agents/subagents/crowd-pulse-steward-fast';
import { flags, getBooleanFlag } from '@/lib/feature-flags';
import { createLogger } from '@/lib/logging';
import {
  applyOrchestrationEnvelope,
  extractOrchestrationEnvelope,
} from '@/lib/agents/shared/orchestration-envelope';
import { createSwarmOrchestrator } from '@/lib/agents/swarm/orchestrator';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

// Thin router: receives dispatch_to_conductor and hands off to stewards
const queue = new AgentTaskQueue();

const FAIRY_INTENT_DEDUPE_MS = Number(process.env.FAIRY_INTENT_DEDUPE_MS ?? 1200);
const FAIRY_INTENT_DEDUPE_MAX = Number(process.env.FAIRY_INTENT_DEDUPE_MAX ?? 200);
const fairyIntentDedupe = new Map<string, number>();

const CLIENT_CANVAS_AGENT_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED, false);
const FAIRY_UI_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_FAIRY_ENABLED, false);
const CANVAS_STEWARD_ENABLED = (process.env.CANVAS_STEWARD_SERVER_EXECUTION ?? 'true') === 'true';
const DEFAULT_SUMMARY_MEMORY_TOOL = process.env.SUMMARY_MEMORY_MCP_TOOL;
const DEFAULT_SUMMARY_AUTO_SEND = process.env.SUMMARY_MEMORY_AUTO_SEND === 'true';
const DEFAULT_SUMMARY_MEMORY_COLLECTION = process.env.SUMMARY_MEMORY_MCP_COLLECTION;
const DEFAULT_SUMMARY_MEMORY_INDEX = process.env.SUMMARY_MEMORY_MCP_INDEX;
const DEFAULT_SUMMARY_MEMORY_NAMESPACE = process.env.SUMMARY_MEMORY_MCP_NAMESPACE;
const SERVER_CANVAS_AGENT_ENABLED = CANVAS_STEWARD_ENABLED && !CLIENT_CANVAS_AGENT_ENABLED;
const SERVER_CANVAS_TASKS_ENABLED = CANVAS_STEWARD_ENABLED && !CLIENT_CANVAS_AGENT_ENABLED;

const CanvasAgentPromptSchema = z
  .object({
    room: z.string().min(1, 'room is required'),
    message: z.string().min(1, 'message is required'),
    requestId: z.string().min(1).optional(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      })
      .partial({ w: true, h: true })
      .optional(),
    selectionIds: z.array(z.string().min(1)).optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .passthrough();

type CanvasAgentPromptInput = z.infer<typeof CanvasAgentPromptSchema>;

const FairyIntentTaskSchema = FairyIntentSchema.extend({
  id: z.string().optional(),
  timestamp: z.number().optional(),
  source: FairyIntentSchema.shape.source.optional(),
  contextProfile: z.string().optional(),
}).passthrough();

type FairyIntentTaskInput = z.infer<typeof FairyIntentTaskSchema>;

const ScorecardTaskArgs = z
  .object({
    room: z.string().min(1, 'room is required'),
    componentId: z.string().min(1, 'componentId is required'),
    windowMs: z.number().min(1_000).max(600_000).optional(),
    intent: z.string().optional(),
    summary: z.string().optional(),
    prompt: z.string().optional(),
    topic: z.string().optional(),
    players: z
      .array(
        z.object({
          side: z.enum(['AFF', 'NEG']),
          label: z.string().min(1),
          avatarUrl: z.string().optional(),
        }),
      )
      .optional(),
    seedState: jsonObjectSchema.optional(),
    claimId: z.string().optional(),
    claimIds: z.array(z.string().min(1)).optional(),
    claimHint: z.string().optional(),
    billingUserId: z.string().optional(),
  })
  .passthrough();

type ScorecardTaskInput = z.infer<typeof ScorecardTaskArgs>;

const ClaimPatchSchema = z
  .object({
    op: z.enum(['upsert', 'delete']).optional().default('upsert'),
    id: z.string().optional(),
    side: debateSideEnum.optional(),
    speech: debateSpeechEnum.optional(),
    quote: z.string().optional(),
    summary: z.string().optional(),
    speaker: z.string().optional(),
    evidenceInline: z.string().optional(),
    status: claimStatusEnum.optional(),
    verdict: verdictEnum.optional(),
    impact: impactEnum.optional(),
  })
  .passthrough();

const ScorecardPatchSchema = z
  .object({
    topic: z.string().optional(),
    claimPatches: z.array(ClaimPatchSchema).optional(),
  })
  .passthrough()
  .refine(
    (value) =>
      (typeof value.topic === 'string' && value.topic.trim().length > 0) ||
      (Array.isArray(value.claimPatches) && value.claimPatches.length > 0),
    { message: 'patch must include topic or claimPatches' },
  );

type ScorecardPatchPayload = z.infer<typeof ScorecardPatchSchema>;

const SearchTaskArgs = z
  .object({
    room: z.string().min(1, 'room is required'),
    query: z.string().min(3, 'query is required'),
    maxResults: z.number().int().min(1).max(6).optional(),
    includeAnswer: z.boolean().optional(),
    topic: z.string().optional(),
    componentId: z.string().optional(),
  })
  .passthrough();

const SCORECARD_AUTO_FACT_CHECK_ENABLED = (process.env.SCORECARD_AUTO_FACT_CHECK ?? 'true') === 'true';
const SCORECARD_AUTO_FACT_CHECK_MIN_INTERVAL_MS = Number(
  process.env.SCORECARD_AUTO_FACT_CHECK_MIN_INTERVAL_MS ?? 10_000,
);
const SCORECARD_AUTO_FACT_CHECK_MAX_CLAIMS = Number(process.env.SCORECARD_AUTO_FACT_CHECK_MAX_CLAIMS ?? 2);

const scorecardAutoFactCheckLedger = new Map<string, number>();
const scorecardExecutionLocks = new Map<string, Promise<void>>();
const logger = createLogger('agents:conductor:router');
let swarmOrchestrator: ReturnType<typeof createSwarmOrchestrator> | null = null;

const getSwarmOrchestrator = () => {
  if (!swarmOrchestrator) {
    swarmOrchestrator = createSwarmOrchestrator({
      executeLegacy: executeTaskLegacy,
    });
  }
  return swarmOrchestrator;
};

async function withScorecardLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = scorecardExecutionLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const current = previous.then(() => next);
  scorecardExecutionLocks.set(key, current);

  await previous;
  try {
    return await fn();
  } finally {
    try {
      if (release) release();
    } finally {
      if (scorecardExecutionLocks.get(key) === current) {
        scorecardExecutionLocks.delete(key);
      }
    }
  }
}

async function handleCanvasAgentPrompt(rawParams: JsonObject) {
  const parsed: CanvasAgentPromptInput = CanvasAgentPromptSchema.parse(rawParams);
  const requestId = (parsed.requestId || randomUUID()).trim();
  const boundsCandidate = parsed.bounds;
  const payload: CanvasAgentPromptPayload = {
    message: parsed.message.trim(),
    requestId,
    bounds:
      boundsCandidate &&
        typeof boundsCandidate.x === 'number' &&
        typeof boundsCandidate.y === 'number' &&
        typeof boundsCandidate.w === 'number' &&
        typeof boundsCandidate.h === 'number'
        ? {
          x: boundsCandidate.x,
          y: boundsCandidate.y,
          w: boundsCandidate.w,
          h: boundsCandidate.h,
        }
        : undefined,
    selectionIds: parsed.selectionIds,
    metadata: parsed.metadata ?? null,
  };

  await broadcastAgentPrompt({
    room: parsed.room.trim(),
    payload,
  });

  return { status: 'queued', requestId, room: parsed.room.trim(), payload };
}

function buildFairyIntent(rawParams: JsonObject): FairyIntent {
  const parsed: FairyIntentTaskInput = FairyIntentTaskSchema.parse(rawParams);
  const id = (parsed.id || randomUUID()).trim();
  const timestamp =
    typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp) ? parsed.timestamp : Date.now();
  const source = parsed.source ?? 'ui';
  const contextProfile = normalizeFairyContextProfile(parsed.contextProfile);
  const intent: FairyIntent = normalizeFairyIntent({
    id,
    room: parsed.room,
    message: parsed.message,
    source,
    timestamp,
    selectionIds: parsed.selectionIds,
    bounds: parsed.bounds,
    metadata: parsed.metadata ?? null,
    componentId: parsed.componentId,
    contextProfile,
  });
  return intent;
}

const buildFairyIntentFingerprint = (intent: FairyIntent) => {
  const selectionKey = Array.isArray(intent.selectionIds)
    ? intent.selectionIds.slice().sort().join(',')
    : '';
  const boundsKey = intent.bounds
    ? [
        Math.round(intent.bounds.x),
        Math.round(intent.bounds.y),
        Math.round(intent.bounds.w),
        Math.round(intent.bounds.h),
      ].join(':')
    : '';
  const messageKey = intent.message.trim().toLowerCase();
  return [intent.room, intent.source, messageKey, intent.componentId ?? '', selectionKey, boundsKey].join('|');
};

const inferCrowdPulseQuestion = (message: string): string | undefined => {
  const trimmed = message.trim();
  if (!trimmed) return undefined;
  const explicit =
    trimmed.match(/(?:question|ask|prompt)(?:\s*(?:is|:|to))?\s*["“]?([^"”\n]+)["”]?/i) ??
    trimmed.match(/add\s+question(?:\s*(?:is|:|to))?\s*["“]?([^"”\n]+)["”]?/i);
  if (explicit?.[1]) {
    const candidate = explicit[1].trim();
    if (candidate.length > 0) return candidate.replace(/[.]+$/, '');
  }
  const firstQuestion = trimmed.match(/([^.!?\n]*\?)/);
  if (firstQuestion?.[1]) {
    const candidate = firstQuestion[1].trim();
    if (candidate.length > 0) return candidate;
  }
  return undefined;
};

const shouldDedupeFairyIntent = (intent: FairyIntent) => {
  if (!FAIRY_INTENT_DEDUPE_MS || FAIRY_INTENT_DEDUPE_MS < 1) return false;
  const metadata = intent.metadata as Record<string, unknown> | null;
  if (metadata && metadata.dedupe === false) return false;
  const now = Date.now();
  const fingerprint = buildFairyIntentFingerprint(intent);
  const lastSeen = fairyIntentDedupe.get(fingerprint);
  fairyIntentDedupe.set(fingerprint, now);

  const cutoff = now - FAIRY_INTENT_DEDUPE_MS;
  for (const [key, ts] of fairyIntentDedupe) {
    if (ts < cutoff) {
      fairyIntentDedupe.delete(key);
    }
  }
  while (fairyIntentDedupe.size > FAIRY_INTENT_DEDUPE_MAX) {
    const first = fairyIntentDedupe.keys().next().value;
    if (!first) break;
    fairyIntentDedupe.delete(first);
  }

  return typeof lastSeen === 'number' && now - lastSeen <= FAIRY_INTENT_DEDUPE_MS;
};

const resolveIntentContextProfile = (intent: FairyIntent, decision: FairyRouteDecision): FairyContextProfile => {
  const metadata = intent.metadata as Record<string, unknown> | null;
  const metaProfile =
    normalizeFairyContextProfile(metadata?.contextProfile) ??
    normalizeFairyContextProfile(metadata?.profile) ??
    normalizeFairyContextProfile((metadata as any)?.promptSummary?.profile);
  const spectrumProfile =
    resolveProfileFromSpectrum(intent.spectrum) ??
    resolveProfileFromSpectrum(metadata?.spectrum) ??
    resolveProfileFromSpectrum((metadata as any)?.promptSummary?.spectrum);

  return (
    intent.contextProfile ??
    metaProfile ??
    spectrumProfile ??
    decision.contextProfile ??
    (decision.kind === 'view'
      ? 'glance'
      : decision.kind === 'summary' || decision.kind === 'bundle'
        ? 'deep'
        : DEFAULT_FAIRY_CONTEXT_PROFILE)
  );
};

const buildIntentMetadata = (
  intent: FairyIntent,
  decision: FairyRouteDecision,
  contextProfile: FairyContextProfile,
) => {
  const base =
    intent.metadata && typeof intent.metadata === 'object' && !Array.isArray(intent.metadata)
      ? (intent.metadata as Record<string, unknown>)
      : {};

  const metadata = {
    ...base,
    contextProfile,
    spectrum: getFairyContextSpectrum(contextProfile).value,
    intent: {
      id: intent.id,
      source: intent.source,
      kind: decision.kind,
      confidence: decision.confidence,
      summary: decision.summary,
    },
  };
  return JSON.parse(JSON.stringify(metadata)) as JsonObject;
};

const extractContextBundle = (metadata: Record<string, unknown> | null) => {
  if (!metadata) return undefined;
  const promptData = (metadata as any).promptData;
  const promptSummary = (metadata as any).promptSummary;
  if (Array.isArray(promptData)) {
    return {
      parts: promptData,
      summary: promptSummary ?? undefined,
    };
  }
  const bundle = (metadata as any).contextBundle;
  if (bundle && Array.isArray(bundle.parts)) {
    return bundle;
  }
  return undefined;
};

type SummaryResult = {
  title?: string;
  summary: string;
  highlights?: string[];
  decisions?: string[];
  actionItems?: Array<{ task: string; owner?: string; due?: string }>;
  tags?: string[];
};

const formatSummaryMarkdown = (result: SummaryResult) => {
  const lines: string[] = [];
  const title = result.title?.trim() || 'Meeting Summary';
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(result.summary.trim());

  if (result.highlights?.length) {
    lines.push('');
    lines.push('## Highlights');
    lines.push(result.highlights.map((item) => `- ${item}`).join('\n'));
  }

  if (result.decisions?.length) {
    lines.push('');
    lines.push('## Decisions');
    lines.push(result.decisions.map((item) => `- ${item}`).join('\n'));
  }

  if (result.actionItems?.length) {
    lines.push('');
    lines.push('## Action Items');
    lines.push(
      result.actionItems
        .map((item) => {
          const owner = item.owner ? ` - ${item.owner}` : '';
          const due = item.due ? ` (due ${item.due})` : '';
          return `- ${item.task}${owner}${due}`;
        })
        .join('\n'),
    );
  }

  if (result.tags?.length) {
    lines.push('');
    lines.push(`Tags: ${result.tags.join(', ')}`);
  }

  return { title, content: lines.join('\n') };
};

const dispatchSummaryDocument = async (
  intent: FairyIntent,
  decision: Pick<FairyRouteDecision, 'summary' | 'message'>,
  contextProfile: FairyContextProfile,
  contextBundle?: { parts?: unknown[] } | undefined,
) => {
  const bundleText =
    contextBundle && Array.isArray(contextBundle.parts)
      ? formatFairyContextParts(contextBundle.parts as any, 5000)
      : '';
  const instruction = decision.summary?.trim() || decision.message?.trim() || intent.message;
  const result = await runSummaryStewardFast({
    room: intent.room,
    instruction,
    contextBundle: bundleText,
    contextProfile,
  });
  const formatted = formatSummaryMarkdown(result);
  const documentId = `${intent.id}-summary`;
  const metadata = intent.metadata as Record<string, unknown> | null;
  const crmToolName =
    typeof metadata?.summaryMcpTool === 'string'
      ? metadata.summaryMcpTool
      : typeof metadata?.crmToolName === 'string'
        ? metadata.crmToolName
        : DEFAULT_SUMMARY_MEMORY_TOOL;
  const autoSend =
    typeof metadata?.summaryAutoSend === 'boolean'
      ? metadata.summaryAutoSend
      : typeof metadata?.autoSend === 'boolean'
        ? metadata.autoSend
        : DEFAULT_SUMMARY_AUTO_SEND
          ? true
          : undefined;
  const memoryCollection =
    typeof metadata?.memoryCollection === 'string'
      ? metadata.memoryCollection
      : DEFAULT_SUMMARY_MEMORY_COLLECTION;
  const memoryIndex =
    typeof metadata?.memoryIndex === 'string' ? metadata.memoryIndex : DEFAULT_SUMMARY_MEMORY_INDEX;
  const memoryNamespace =
    typeof metadata?.memoryNamespace === 'string'
      ? metadata.memoryNamespace
      : DEFAULT_SUMMARY_MEMORY_NAMESPACE;
  await broadcastToolCall({
    room: intent.room,
    tool: 'dispatch_dom_event',
    params: {
      event: 'context:document-added',
      detail: {
        id: documentId,
        title: formatted.title,
        content: formatted.content,
        type: 'markdown',
        source: 'paste',
        timestamp: Date.now(),
      },
    },
  });
  const requestedId = intent.componentId?.trim();
  const summaryComponentId =
    requestedId && requestedId.toLowerCase().includes('summary')
      ? requestedId
      : `MeetingSummaryWidget-${intent.room}`;
  const summaryPatch = {
    title: formatted.title,
    summary: result.summary,
    highlights: Array.isArray(result.highlights) ? result.highlights : [],
    decisions: Array.isArray(result.decisions) ? result.decisions : [],
    actionItems: Array.isArray(result.actionItems) ? result.actionItems : [],
    tags: Array.isArray(result.tags) ? result.tags : [],
    sourceDocumentId: documentId,
    contextProfile,
    lastUpdated: Date.now(),
    ...(crmToolName ? { crmToolName } : {}),
    ...(typeof autoSend === 'boolean' ? { autoSend } : {}),
    ...(memoryCollection ? { memoryCollection } : {}),
    ...(memoryIndex ? { memoryIndex } : {}),
    ...(memoryNamespace ? { memoryNamespace } : {}),
  };
  await broadcastToolCall({
    room: intent.room,
    tool: 'create_component',
    params: {
      type: 'MeetingSummaryWidget',
      messageId: summaryComponentId,
      intentId: intent.id,
      props: summaryPatch,
    },
  });
  await broadcastToolCall({
    room: intent.room,
    tool: 'update_component',
    params: {
      componentId: summaryComponentId,
      patch: summaryPatch,
    },
  });
  return { status: 'queued', intentId: intent.id, documentId, summary: result.summary };
};

async function dispatchFastLane(intent: FairyIntent, decision: FairyRouteDecision) {
  if (!decision.fastLaneEvent) return;
  const detail = decision.fastLaneDetail ? { ...decision.fastLaneDetail } : undefined;
  const detailWithRoom =
    detail ?? (intent.room ? { roomName: intent.room } : undefined);
  if (detailWithRoom && !detailWithRoom.componentId && intent.componentId) {
    detailWithRoom.componentId = intent.componentId;
  }
  if (detailWithRoom && !detailWithRoom.roomName && intent.room) {
    detailWithRoom.roomName = intent.room;
  }
  const detailPayload: JsonObject | undefined = detailWithRoom
    ? (JSON.parse(JSON.stringify(detailWithRoom)) as JsonObject)
    : undefined;
  await broadcastToolCall({
    room: intent.room,
    tool: 'dispatch_dom_event',
    params: {
      event: decision.fastLaneEvent,
      ...(detailPayload ? { detail: detailPayload } : {}),
    },
  });
}

async function ensureWidgetComponent(intent: FairyIntent, componentType: string) {
  const requestedId = intent.componentId?.trim();
  let components: Awaited<ReturnType<typeof listCanvasComponents>> = [];
  try {
    components = await listCanvasComponents(intent.room);
  } catch (error) {
    logger.warn('[Conductor] failed to list canvas components for widget ensure', {
      room: intent.room,
      componentType,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (requestedId) {
    const existingById = components.find((component) => component.componentId === requestedId);
    if (existingById && existingById.componentType === componentType) {
      return requestedId;
    }
    if (existingById && existingById.componentType !== componentType) {
      const remappedComponentId = `${componentType}-${intent.id}`;
      logger.warn('[Conductor] requested widget id resolves to a different component type', {
        room: intent.room,
        requestedId,
        requestedType: componentType,
        existingType: existingById.componentType,
        remappedComponentId,
      });
      const existingRemapped = components.find(
        (component) => component.componentId === remappedComponentId && component.componentType === componentType,
      );
      if (existingRemapped) {
        return remappedComponentId;
      }
      await broadcastToolCall({
        room: intent.room,
        tool: 'create_component',
        params: {
          type: componentType,
          messageId: remappedComponentId,
          intentId: intent.id,
        },
      });
      return remappedComponentId;
    }

    await broadcastToolCall({
      room: intent.room,
      tool: 'create_component',
      params: {
        type: componentType,
        messageId: requestedId,
        intentId: intent.id,
      },
    });
    return requestedId;
  }

  const existingByType = components
    .filter((component) => component.componentType === componentType)
    .sort((a, b) => {
      const aStamp = typeof a.lastUpdated === 'number' ? a.lastUpdated : 0;
      const bStamp = typeof b.lastUpdated === 'number' ? b.lastUpdated : 0;
      return bStamp - aStamp;
    })[0];

  if (existingByType?.componentId) {
    return existingByType.componentId;
  }

  const componentId = requestedId || `${componentType}-${intent.id}`;
  await broadcastToolCall({
    room: intent.room,
    tool: 'create_component',
    params: {
      type: componentType,
      messageId: componentId,
      intentId: intent.id,
    },
  });
  return componentId;
}

async function handleFairyIntent(rawParams: JsonObject) {
  const intent = buildFairyIntent(rawParams);
  if (shouldDedupeFairyIntent(intent)) {
    return { status: 'deduped', intentId: intent.id, room: intent.room };
  }
  const decision = await routeFairyIntent(intent);
  const contextProfile = resolveIntentContextProfile(intent, decision);
  const mergedMetadata = buildIntentMetadata(intent, decision, contextProfile);
  const contextBundle = extractContextBundle(
    intent.metadata && typeof intent.metadata === 'object' && !Array.isArray(intent.metadata)
      ? (intent.metadata as Record<string, unknown>)
      : null,
  );

  const executeDecision = async (decisionLike: Partial<FairyRouteDecision> & { kind?: string }) => {
    const actionProfile =
      normalizeFairyContextProfile(decisionLike.contextProfile) ?? contextProfile;
    const actionMetadata =
      actionProfile === contextProfile
        ? mergedMetadata
        : { ...mergedMetadata, contextProfile: actionProfile };
    const message = decisionLike.message?.trim() || intent.message;
    const summary = typeof decisionLike.summary === 'string' ? decisionLike.summary : decision.summary;

    if (decisionLike.fastLaneEvent) {
      try {
        await dispatchFastLane(intent, decisionLike as FairyRouteDecision);
      } catch (error) {
        logger.warn('[Conductor] fast-lane dispatch failed', {
          intentId: intent.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!decisionLike.kind || decisionLike.kind === 'bundle') {
      return { status: 'handled', intentId: intent.id, decision };
    }

    if (decisionLike.kind === 'view' || decisionLike.kind === 'none') {
      return { status: 'handled', intentId: intent.id, decision };
    }

    if (decisionLike.kind === 'summary') {
      return dispatchSummaryDocument(intent, { summary, message }, actionProfile, contextBundle);
    }

    if (decisionLike.kind === 'crowd_pulse') {
      const componentId = await ensureWidgetComponent(intent, 'CrowdPulseWidget');
      const bundleText =
        contextBundle && Array.isArray(contextBundle.parts)
          ? formatFairyContextParts(contextBundle.parts as any, 3000)
          : '';
      const patch = await runCrowdPulseStewardFast({
        room: intent.room,
        instruction: message,
        contextBundle: bundleText,
        contextProfile: actionProfile,
      });
      const inferredQuestion =
        typeof patch.activeQuestion === 'string' ? undefined : inferCrowdPulseQuestion(message);
      const updatePatch = {
        ...patch,
        ...(inferredQuestion ? { activeQuestion: inferredQuestion } : {}),
        lastUpdated: Date.now(),
      };
      await broadcastToolCall({
        room: intent.room,
        tool: 'update_component',
        params: {
          componentId,
          patch: updatePatch,
        },
      });
      return { status: 'queued', intentId: intent.id, decision, componentId };
    }

    if (decisionLike.kind === 'canvas') {
      return executeTaskLegacy('canvas.agent_prompt', {
        room: intent.room,
        message,
        requestId: intent.id,
        ...(intent.bounds ? { bounds: intent.bounds } : {}),
        ...(Array.isArray(intent.selectionIds) ? { selectionIds: intent.selectionIds } : {}),
        ...(actionMetadata ? { metadata: actionMetadata } : {}),
      });
    }

    if (decisionLike.kind === 'scorecard') {
      const componentId = await ensureWidgetComponent(intent, 'DebateScorecard');
      return executeTaskLegacy('scorecard.run', {
        room: intent.room,
        componentId,
        prompt: message,
        ...(summary ? { summary } : {}),
        intent: 'scorecard.run',
      });
    }

    if (decisionLike.kind === 'infographic') {
      const componentId = await ensureWidgetComponent(intent, 'InfographicWidget');
      await broadcastToolCall({
        room: intent.room,
        tool: 'update_component',
        params: {
          componentId,
          patch: {
            instruction: message,
            contextProfile: actionProfile,
            intentId: intent.id,
            contextBundle,
          },
        },
      });
      return { status: 'queued', intentId: intent.id, decision, componentId };
    }

    if (decisionLike.kind === 'kanban') {
      const componentId = await ensureWidgetComponent(intent, 'LinearKanbanBoard');
      await broadcastToolCall({
        room: intent.room,
        tool: 'update_component',
        params: {
          componentId,
          patch: {
            instruction: message,
            contextProfile: actionProfile,
            intentId: intent.id,
            contextBundle,
          },
        },
      });
      return { status: 'queued', intentId: intent.id, decision, componentId };
    }

    return { status: 'skipped', intentId: intent.id, decision };
  };

  const results: Array<unknown> = [];
  if (decision.kind !== 'bundle') {
    results.push(await executeDecision(decision));
  }
  if (Array.isArray((decision as any).actions)) {
    for (const action of (decision as any).actions) {
      results.push(await executeDecision(action));
    }
  }

  if (results.length === 1) {
    return results[0];
  }

  return { status: 'handled', intentId: intent.id, decision, results };
}

async function primeFactCheckStatus(params: ScorecardTaskInput) {
  const { room, componentId } = params;
  let latestRecord: { state: DebateScorecardState; version: number; lastUpdated: number } | null = null;
  try {
    const record = await getDebateScorecard(room, componentId);
    latestRecord = record;
    const baseState = record?.state;
    if (!baseState) {
      seedScorecardState(room, componentId, record);
      return;
    }

    const workingState = JSON.parse(JSON.stringify(baseState)) as DebateScorecardState;
    const targets = pickFactCheckTargets(workingState, params);
    if (targets.length === 0) {
      seedScorecardState(room, componentId, record);
      return;
    }

    const timestamp = Date.now();
    let updated = false;
    for (const id of targets) {
      const claim = workingState.claims.find((c) => c.id === id);
      if (!claim) continue;
      if (claim.status !== 'CHECKING') {
        claim.status = 'CHECKING';
        claim.updatedAt = timestamp;
        updated = true;
      }
    }

    const pending = new Set(workingState.status?.pendingVerifications ?? []);
    targets.forEach((id) => pending.add(id));
    const lastActionText = params.summary?.trim()
      ? `Fact check requested: ${params.summary.trim().slice(0, 120)}`
      : `Fact check requested for ${targets.join(', ')}`;

    workingState.status = {
      ...workingState.status,
      pendingVerifications: Array.from(pending),
      lastAction: lastActionText,
    };

    if (!updated) {
      seedScorecardState(room, componentId, record);
      return;
    }

    workingState.timeline = [
      ...workingState.timeline,
      {
        id: `evt-${timestamp}`,
        timestamp,
        text: lastActionText,
        type: 'fact_check',
      },
    ];

    const committed = await commitDebateScorecard(room, componentId, {
      state: workingState,
      prevVersion: record.version,
    });
    latestRecord = committed;
    seedScorecardState(room, componentId, committed);
    await broadcastToolCall({
      room,
      tool: 'update_component',
      params: {
        componentId,
        patch: { ...committed.state, version: committed.version } as unknown as JsonObject,
      },
    });
    logger.info('[Conductor] primed fact check status', {
      room,
      componentId,
      claims: targets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[Conductor] failed to prime fact check status', {
      room: params.room,
      componentId: params.componentId,
      error: message,
    });
    if (latestRecord) {
      seedScorecardState(params.room, params.componentId, latestRecord);
    }
  }
}

const tokenizeText = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

function scoreTokenOverlap(
  text: string | undefined,
  hintTokens: string[],
  perTokenWeight: number,
  maxWeight: number,
): number {
  if (!text || hintTokens.length === 0) return 0;
  const textTokens = tokenizeText(text);
  if (!textTokens.length) return 0;
  const tokenSet = new Set(textTokens);
  let matches = 0;
  for (const token of hintTokens) {
    if (tokenSet.has(token)) {
      matches += 1;
    }
  }
  if (matches === 0) return 0;
  return Math.min(maxWeight, matches * perTokenWeight);
}

function pickFactCheckTargets(state: DebateScorecardState, params: ScorecardTaskInput): string[] {
  const directIds = new Set<string>();
  if (params.claimId && params.claimId.trim()) {
    directIds.add(params.claimId.trim());
  }
  if (Array.isArray(params.claimIds)) {
    params.claimIds.forEach((id) => {
      if (id && id.trim()) directIds.add(id.trim());
    });
  }

  const hint = (params.claimHint || params.prompt || params.summary || '').toLowerCase().trim();
  const hintTokens = hint ? tokenizeText(hint) : [];
  if (directIds.size === 0 && hint) {
    const scored = state.claims
      .map((claim) => ({ id: claim.id, score: scoreClaimMatch(claim, hint, hintTokens) }))
      .filter((entry) => entry.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    for (const entry of scored) {
      directIds.add(entry.id);
    }
  }

  if (directIds.size === 0 && state.claims.length > 0) {
    const sorted = state.claims.slice().sort((a, b) => {
      const aTime = a.updatedAt ?? a.createdAt ?? 0;
      const bTime = b.updatedAt ?? b.createdAt ?? 0;
      return bTime - aTime;
    });
    directIds.add(sorted[0].id);
  }

  return Array.from(directIds);
}

function scoreClaimMatch(claim: Claim, hint: string, hintTokens: string[]): number {
  let score = 0;
  const target = hint.toLowerCase();
  if (target.includes(claim.id.toLowerCase())) score += 4;
  if (claim.summary && target.includes(claim.summary.toLowerCase())) score += 3;
  else {
    score += scoreTokenOverlap(claim.summary, hintTokens, 0.4, 1.6);
  }
  if (claim.quote) {
    const trimmedQuote = claim.quote.toLowerCase().slice(0, 160);
    if (trimmedQuote && target.includes(trimmedQuote)) score += 2;
    else {
      score += scoreTokenOverlap(claim.quote, hintTokens, 0.3, 1.2);
    }
  }
  if (claim.speaker && target.includes(claim.speaker.toLowerCase())) score += 0.75;
  if (target.includes(claim.side.toLowerCase())) score += 0.75;
  if (claim.speech && target.includes(claim.speech.toLowerCase())) score += 0.5;
  return score;
}

async function maybeEnqueueAutoFactChecks(params: ScorecardTaskInput, taskName: string) {
  if (!SCORECARD_AUTO_FACT_CHECK_ENABLED) return;
  if (taskName === 'scorecard.fact_check') return;
  if (taskName === 'scorecard.seed') return;

  const throttleKey = `${params.room}:${params.componentId}`;
  const now = Date.now();
  const lastAt = scorecardAutoFactCheckLedger.get(throttleKey) ?? 0;
  if (now - lastAt < SCORECARD_AUTO_FACT_CHECK_MIN_INTERVAL_MS) return;

  const record = await getDebateScorecard(params.room, params.componentId);
  const state = record?.state;
  if (!state || state.factCheckEnabled !== true) return;

  const pending = new Set(state.status?.pendingVerifications ?? []);
  const candidates = state.claims
    .filter((claim) => claim.status === 'UNTESTED' && !pending.has(claim.id) && (claim.factChecks?.length ?? 0) === 0)
    .sort((a, b) => {
      const aTime = a.updatedAt ?? a.createdAt ?? 0;
      const bTime = b.updatedAt ?? b.createdAt ?? 0;
      return bTime - aTime;
    })
    .slice(0, Math.max(0, Math.min(3, SCORECARD_AUTO_FACT_CHECK_MAX_CLAIMS)));

  if (candidates.length === 0) return;

  scorecardAutoFactCheckLedger.set(throttleKey, now);

  const hint = params.summary || params.prompt || params.intent || undefined;
  try {
    await primeFactCheckStatus({
      ...params,
      claimIds: candidates.map((c) => c.id),
      claimHint: typeof hint === 'string' && hint.trim() ? hint.trim().slice(0, 240) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[Conductor] auto fact-check prime failed', {
      room: params.room,
      componentId: params.componentId,
      error: message,
    });
  }
  await queue.enqueueTask({
    room: params.room,
    task: 'scorecard.fact_check',
    params: {
      room: params.room,
      componentId: params.componentId,
      claimIds: candidates.map((c) => c.id),
      claimHint: typeof hint === 'string' && hint.trim() ? hint.trim().slice(0, 240) : undefined,
      provider: 'openai',
      provider_source: 'runtime_selected',
      provider_path: 'primary',
      model:
        process.env.CANVAS_STEWARD_SEARCH_MODEL ||
        process.env.DEBATE_STEWARD_SEARCH_MODEL ||
        'gpt-5-mini',
    } as unknown as JsonObject,
    dedupeKey: `scorecard.fact_check:auto:${params.componentId}:${candidates.map((c) => c.id).join(',')}`,
    resourceKeys: [`room:${params.room}`, `scorecard:${params.componentId}`],
    priority: 1,
  });

  logger.info('[Conductor] auto-enqueued scorecard.fact_check', {
    room: params.room,
    componentId: params.componentId,
    claims: candidates.map((c) => c.id),
  });
}

function isDefaultScorecardTopic(topic: string | undefined | null) {
  const normalized = (topic || '').trim().toLowerCase();
  return normalized.length === 0 || normalized === 'untitled debate' || normalized === 'live debate';
}

function isDefaultPlayerLabel(label: string | undefined | null, side: 'AFF' | 'NEG') {
  const normalized = (label || '').trim().toLowerCase();
  if (!normalized) return true;
  if (side === 'AFF') return normalized === 'affirmative' || normalized === 'aff' || normalized === 'pro';
  return normalized === 'negative' || normalized === 'neg' || normalized === 'con';
}

async function upsertScorecardMeta(parsed: ScorecardTaskInput) {
  const { room, componentId } = parsed;
  const record = await getDebateScorecard(room, componentId);
  const base = record?.state ? JSON.parse(JSON.stringify(record.state)) : null;
  let workingState: DebateScorecardState =
    base && typeof base === 'object'
      ? (base as DebateScorecardState)
      : debateScorecardStateSchema.parse({ componentId });

  const desiredTopic =
    typeof parsed.topic === 'string' && parsed.topic.trim().length > 0 ? parsed.topic.trim() : undefined;

  let changed = false;

  if (parsed.seedState && typeof parsed.seedState === 'object') {
    try {
      const seedCandidate = debateScorecardStateSchema.parse({
        ...(parsed.seedState as JsonObject),
        componentId,
      });
      const safeToSeed =
        record.version === 0 &&
        (workingState.claims?.length ?? 0) === 0 &&
        (workingState.timeline?.length ?? 0) <= 2;
      if (safeToSeed) {
        workingState = seedCandidate;
        changed = true;
      }
    } catch (error) {
      logger.warn('[Conductor] scorecard.seed ignored invalid seedState', {
        room,
        componentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!Array.isArray(workingState.players) || workingState.players.length < 2) {
    workingState.players = createDefaultPlayers();
    changed = true;
  }

  if (desiredTopic && (isDefaultScorecardTopic(workingState.topic) || workingState.topic !== desiredTopic)) {
    workingState.topic = desiredTopic;
    changed = true;
  }

  if (Array.isArray(parsed.players) && parsed.players.length > 0) {
    for (const update of parsed.players) {
      const side = update.side;
      const desiredLabel = update.label.trim();
      if (!desiredLabel) continue;
      const idx = workingState.players.findIndex((p) => p.side === side);
      if (idx === -1) continue;
      const current = workingState.players[idx];
      const shouldReplace = isDefaultPlayerLabel(current.label, side) || current.label !== desiredLabel;
      if (shouldReplace) {
        workingState.players[idx] = {
          ...current,
          label: desiredLabel,
          avatarUrl: update.avatarUrl ?? current.avatarUrl,
          lastUpdated: Date.now(),
        };
        changed = true;
      }
    }
  }

  if (!changed) {
    logger.info('[Conductor] scorecard meta already up to date', { room, componentId });
    seedScorecardState(room, componentId, record);
    return { status: 'no_change', version: record.version };
  }

  const timestamp = Date.now();
  const lastActionText = [
    desiredTopic ? `Topic: ${desiredTopic}` : null,
    Array.isArray(parsed.players) && parsed.players.length
      ? `Players: ${workingState.players.map((p) => p.label).join(' vs ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  workingState.status = {
    ...workingState.status,
    lastAction: lastActionText || workingState.status?.lastAction,
  };
  workingState.timeline = [
    ...(workingState.timeline ?? []),
    {
      id: `evt-${timestamp}`,
      timestamp,
      text: lastActionText || 'Scorecard metadata updated.',
      type: 'moderation',
    },
  ];

  const committed = await commitDebateScorecard(room, componentId, {
    state: workingState,
    prevVersion: record.version,
  });

  seedScorecardState(room, componentId, committed);
  await broadcastToolCall({
    room,
    tool: 'update_component',
    params: {
      componentId,
      patch: committed.state as JsonObject,
    },
  });

  logger.info('[Conductor] scorecard meta committed', { room, componentId, version: committed.version });
  return { status: 'ok', version: committed.version };
}

function nextClaimId(state: DebateScorecardState, side: 'AFF' | 'NEG'): string {
  const prefix = `${side}-`;
  let max = 0;
  for (const claim of state.claims || []) {
    const id = String(claim?.id || '');
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, Math.floor(n));
  }
  return `${side}-${max + 1}`;
}

function applyClaimPatch(
  state: DebateScorecardState,
  patch: z.infer<typeof ClaimPatchSchema>,
  now: number,
): { changed: boolean; id?: string; op: 'upsert' | 'delete' } {
  const op = (patch.op || 'upsert') as 'upsert' | 'delete';
  const rawId = typeof patch.id === 'string' ? patch.id.trim() : '';

  if (op === 'delete') {
    if (!rawId) return { changed: false, op };
    const idx = state.claims.findIndex((c) => c.id === rawId);
    if (idx === -1) return { changed: false, id: rawId, op };
    state.claims.splice(idx, 1);
    return { changed: true, id: rawId, op };
  }

  let id = rawId;
  if (!id) {
    if (patch.side) {
      id = nextClaimId(state, patch.side);
    } else {
      id = `C-${randomUUID().slice(0, 8)}`;
    }
  }

  const idx = state.claims.findIndex((c) => c.id === id);
  const playerLabel = patch.side
    ? state.players.find((p) => p.side === patch.side)?.label
    : undefined;

  if (idx === -1) {
    const side: 'AFF' | 'NEG' = patch.side ?? 'AFF';
    const speech =
      patch.speech ??
      (side === 'NEG' ? '1NC' : '1AC');
    const quote = typeof patch.quote === 'string' ? patch.quote : '';
    state.claims.push({
      id,
      side,
      speech,
      quote,
      speaker: typeof patch.speaker === 'string' ? patch.speaker : playerLabel || 'Speaker',
      summary: typeof patch.summary === 'string' ? patch.summary : undefined,
      evidenceInline: typeof patch.evidenceInline === 'string' ? patch.evidenceInline : undefined,
      status: patch.status ?? 'UNTESTED',
      strength: { logos: 0.5, pathos: 0.5, ethos: 0.5 },
      confidence: 0.5,
      evidenceCount: 0,
      upvotes: 0,
      scoreDelta: 0,
      factChecks: [],
      verdict: patch.verdict ?? undefined,
      impact: patch.impact ?? undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { changed: true, id, op };
  }

  const current = state.claims[idx];
  const next: Claim = {
    ...current,
    ...(patch.side ? { side: patch.side } : null),
    ...(patch.speech ? { speech: patch.speech } : null),
    ...(typeof patch.quote === 'string' ? { quote: patch.quote } : null),
    ...(typeof patch.summary === 'string' ? { summary: patch.summary } : null),
    ...(typeof patch.speaker === 'string' ? { speaker: patch.speaker } : null),
    ...(typeof patch.evidenceInline === 'string' ? { evidenceInline: patch.evidenceInline } : null),
    ...(patch.status ? { status: patch.status } : null),
    ...(patch.verdict ? { verdict: patch.verdict } : null),
    ...(patch.impact ? { impact: patch.impact } : null),
    updatedAt: now,
  };

  state.claims[idx] = next;
  return { changed: true, id, op };
}

async function runScorecardPatchTask(parsed: ScorecardTaskInput, rawParams: JsonObject) {
  const patchCandidate = (getObject(rawParams, 'patch') as JsonObject | null) ?? rawParams;
  const fallbackTopic =
    typeof parsed.topic === 'string' && parsed.topic.trim().length > 0 ? parsed.topic.trim() : undefined;

  const payload = ScorecardPatchSchema.parse({
    ...patchCandidate,
    ...(fallbackTopic && !(patchCandidate as any)?.topic ? { topic: fallbackTopic } : null),
  }) as ScorecardPatchPayload;

  const record = await getDebateScorecard(parsed.room, parsed.componentId);
  const base = record?.state ? JSON.parse(JSON.stringify(record.state)) : null;
  let workingState: DebateScorecardState =
    base && typeof base === 'object'
      ? (base as DebateScorecardState)
      : debateScorecardStateSchema.parse({ componentId: parsed.componentId });

  const now = Date.now();
  const notes: string[] = [];
  let changed = false;

  if (typeof payload.topic === 'string' && payload.topic.trim().length > 0) {
    const nextTopic = payload.topic.trim();
    if (workingState.topic !== nextTopic) {
      workingState.topic = nextTopic;
      changed = true;
      notes.push(`Topic: ${nextTopic}`);
    }
  }

  const claimPatches = Array.isArray(payload.claimPatches) ? payload.claimPatches : [];
  for (const patch of claimPatches) {
    const result = applyClaimPatch(workingState, patch, now);
    if (!result.changed) continue;
    changed = true;
    if (result.op === 'delete') {
      notes.push(`Deleted ${result.id}`);
    } else {
      notes.push(`Updated ${result.id}`);
    }
  }

  if (!changed) {
    logger.info('[Conductor] scorecard.patch no changes detected', {
      room: parsed.room,
      componentId: parsed.componentId,
    });
    return { status: 'no_change', version: record.version };
  }

  const lastAction = notes.join(' · ').slice(0, 240) || 'Scorecard updated';
  workingState.status = {
    ...workingState.status,
    lastAction,
  };
  workingState.timeline = [
    ...(workingState.timeline ?? []),
    {
      id: `evt-${now}`,
      timestamp: now,
      text: lastAction,
      type: 'moderation',
    },
  ];
  workingState.lastUpdated = now;

  const committed = await commitDebateScorecard(parsed.room, parsed.componentId, {
    state: debateScorecardStateSchema.parse(workingState),
    prevVersion: record.version,
  });

  seedScorecardState(parsed.room, parsed.componentId, committed);
  await broadcastToolCall({
    room: parsed.room,
    tool: 'update_component',
    params: {
      componentId: parsed.componentId,
      patch: committed.state as JsonObject,
    },
  });

  logger.info('[Conductor] scorecard.patch committed', {
    room: parsed.room,
    componentId: parsed.componentId,
    version: committed.version,
    lastAction,
  });

  return { status: 'ok', version: committed.version, lastAction };
}

async function executeTaskLegacy(taskName: string, params: JsonObject) {
  if (!taskName || taskName === 'auto') {
    const resolution = resolveIntent(params);
    if (resolution) {
      const nextParams = resolution.params ? { ...params, ...resolution.params } : params;
      return executeTaskLegacy(resolution.task, nextParams);
    }
    const fallbackParams = params.message
      ? params
      : { ...params, message: resolveIntentText(params) };
    return executeTaskLegacy('fairy.intent', { ...fallbackParams, source: 'system' });
  }

  if (taskName === 'conductor.dispatch') {
    const nextTask = typeof params?.task === 'string' ? params.task : 'auto';
    const payloadCandidate = (params?.params as JsonObject | undefined) ?? params;
    const payload =
      payloadCandidate && typeof payloadCandidate === 'object' && !Array.isArray(payloadCandidate)
        ? (payloadCandidate as JsonObject)
        : ({} as JsonObject);
    const envelope = extractOrchestrationEnvelope(params);
    const enrichedPayload = applyOrchestrationEnvelope(payload, envelope);
    logger.info('[Conductor] dispatch_to_conductor routed', {
      nextTask,
      hasPayload: Object.keys(payload).length > 0,
      executionId: envelope.executionId,
      idempotencyKey: envelope.idempotencyKey,
      lockKey: envelope.lockKey,
      attempt: envelope.attempt,
    });
    return executeTaskLegacy(nextTask, enrichedPayload);
  }

  if (taskName.startsWith('flowchart.')) {
    const result = await run(activeFlowchartSteward, JSON.stringify({ task: taskName, params }));
    return result.finalOutput;
  }

  if (taskName.startsWith('scorecard.')) {
    const parsed = ScorecardTaskArgs.parse(params);
    const isFactCheckTask =
      taskName === 'scorecard.fact_check' || taskName === 'scorecard.verify' || taskName === 'scorecard.refute';
    const canUseFast = !isFactCheckTask && taskName !== 'scorecard.seed' && isFastStewardReady();

    return withScorecardLock(`${parsed.room}:${parsed.componentId}`, async () => {
      if (taskName === 'scorecard.patch') {
        const patchResult = await runScorecardPatchTask(parsed, params);
        return { status: 'completed', output: patchResult };
      }

      if (taskName === 'scorecard.seed') {
        return { status: 'completed', output: await upsertScorecardMeta(parsed) };
      }
      if (isFactCheckTask) {
        await primeFactCheckStatus(parsed);
      }
      if (
        taskName !== 'scorecard.seed' &&
        (typeof parsed.topic === 'string' || (Array.isArray(parsed.players) && parsed.players.length > 0))
      ) {
        try {
          await upsertScorecardMeta(parsed);
        } catch (error) {
          logger.warn('[Conductor] scorecard meta upsert failed before steward dispatch', {
            room: parsed.room,
            componentId: parsed.componentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('[Conductor] dispatching scorecard task', {
        taskName,
        room: parsed.room,
        componentId: parsed.componentId,
        intent: isFactCheckTask ? 'scorecard.fact_check' : parsed.intent ?? taskName,
        canUseFast,
      });

      const factCheckDirective =
        taskName === 'scorecard.verify'
          ? 'Verify the claim(s) and add evidence links. If unsupported or false, mark REFUTED with concise explanation.'
          : taskName === 'scorecard.refute'
            ? 'Try to refute the claim(s) with evidence links. If actually accurate, mark VERIFIED.'
            : null;

      const stewardPrompt =
        factCheckDirective && typeof parsed.prompt === 'string' && parsed.prompt.trim().length > 0
          ? `${factCheckDirective}\n\nUser request: ${parsed.prompt}`
          : factCheckDirective && typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
            ? `${factCheckDirective}\n\nUser request: ${parsed.summary}`
            : factCheckDirective ?? parsed.prompt;
      const billingUserId =
        typeof parsed.billingUserId === 'string' && parsed.billingUserId.trim().length > 0
          ? parsed.billingUserId.trim()
          : null;
      const cerebrasApiKey =
        canUseFast && billingUserId
          ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
          : null;
      const useFastPath = canUseFast && isFastStewardReady(cerebrasApiKey ?? undefined);

      let output: unknown;
      let usedFast = false;

      if (useFastPath) {
        try {
          const fastOutput = await runDebateScorecardStewardFast({
            room: parsed.room,
            componentId: parsed.componentId,
            intent: isFactCheckTask ? 'scorecard.fact_check' : parsed.intent ?? taskName,
            summary: parsed.summary,
            prompt: stewardPrompt,
            topic: parsed.topic,
            cerebrasApiKey: cerebrasApiKey ?? undefined,
          });
          if (
            fastOutput &&
            typeof fastOutput === 'object' &&
            (fastOutput as { status?: unknown }).status === 'error'
          ) {
            throw new Error(
              String(
                (fastOutput as { summary?: unknown }).summary ??
                  'fast scorecard steward returned error status',
              ),
            );
          }
          output = fastOutput;
          usedFast = true;
        } catch (error) {
          logger.warn('[Conductor] fast scorecard steward failed; falling back to full steward', {
            room: parsed.room,
            componentId: parsed.componentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (typeof output === 'undefined') {
        output = await runDebateScorecardSteward({
          room: parsed.room,
          componentId: parsed.componentId,
          windowMs: parsed.windowMs,
          intent: isFactCheckTask ? 'scorecard.fact_check' : parsed.intent ?? taskName,
          summary: parsed.summary,
          prompt: stewardPrompt,
          topic: parsed.topic,
        });
      }

      logger.info('[Conductor] scorecard steward completed', {
        taskName,
        room: parsed.room,
        componentId: parsed.componentId,
        ok: true,
        usedFast,
      });

      if (usedFast) {
        try {
          await maybeEnqueueAutoFactChecks(parsed, taskName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn('[Conductor] auto fact-check enqueue failed', {
            room: parsed.room,
            componentId: parsed.componentId,
            error: message,
          });
        }
      }

      return { status: 'completed', output };
    });
  }

  if (taskName.startsWith('search.')) {
    const parsed = SearchTaskArgs.parse(params);
    logger.info('[Conductor] dispatching search task', {
      taskName,
      room: parsed.room,
      query: parsed.query,
    });
    const result = await runSearchSteward({ task: taskName, params: parsed as JsonObject });
    if (result.status === 'ok' && result.panel) {
      const targetId = parsed.componentId?.trim() || `ui-research-${Date.now().toString(36)}`;
      if (parsed.componentId) {
        await broadcastToolCall({
          room: parsed.room,
          tool: 'update_component',
          params: {
            componentId: targetId,
            patch: result.panel as JsonObject,
          },
        });
      } else {
        await broadcastToolCall({
          room: parsed.room,
          tool: 'create_component',
          params: {
            type: 'ResearchPanel',
            messageId: targetId,
            spec: result.panel as JsonObject,
          },
        });
      }
      logger.info('[Conductor] search steward results broadcast', {
        room: parsed.room,
        componentId: targetId,
        hits: result.bundle?.hits?.length ?? 0,
      });
    }
    return {
      status: result.status,
      output: (result.bundle as JsonObject | null) ?? null,
      error: result.error ?? null,
    };
  }

  if (taskName === 'fairy.intent') {
    return handleFairyIntent(params);
  }

  if (taskName === 'canvas.agent_prompt') {
    const promptResult = await handleCanvasAgentPrompt(params);
    const stewardParams: JsonObject = {
      room: promptResult.room,
      message: promptResult.payload.message,
      requestId: promptResult.payload.requestId,
    };
    if (promptResult.payload.metadata) {
      stewardParams.metadata = promptResult.payload.metadata;
    }
    if (promptResult.payload.bounds) {
      stewardParams.bounds = promptResult.payload.bounds;
    }
    if (promptResult.payload.selectionIds) {
      stewardParams.selectionIds = promptResult.payload.selectionIds;
    }
    if (SERVER_CANVAS_AGENT_ENABLED) {
      // Execute via Canvas Steward on the server to ensure action even without the legacy client host
      await runCanvasSteward({ task: 'canvas.agent_prompt', params: stewardParams });
    } else {
      logger.info('[Conductor] server canvas steward skipped for canvas.agent_prompt', {
        clientLegacyEnabled: CLIENT_CANVAS_AGENT_ENABLED,
        fairyUiEnabled: FAIRY_UI_ENABLED,
      });
    }
    return { ...promptResult, status: 'queued' };
  }

  if (taskName.startsWith('canvas.')) {
    if (!SERVER_CANVAS_TASKS_ENABLED) {
      logger.info('[Conductor] server canvas steward disabled, skipping task', { taskName });
      return { status: 'skipped', taskName };
    }
    return runCanvasSteward({ task: taskName, params });
  }

  throw new Error(`No steward for task: ${taskName}`);
}

export async function executeTask(taskName: string, params: JsonObject) {
  if (!flags.swarmOrchestrationEnabled) {
    return executeTaskLegacy(taskName, params);
  }
  const orchestrator = getSwarmOrchestrator();
  return orchestrator.execute({ taskName, params });
}

function resolveIntentText(params: JsonObject): string {
  const transcript = getString(params, 'transcript');
  if (transcript) return transcript;
  const metadata = getObject(params, 'metadata');
  const metaMessage = metadata ? getString(metadata, 'message') : undefined;
  if (metaMessage) return metaMessage;
  const intent = getString(params, 'intent');
  if (intent) return intent;
  const message = getString(params, 'message');
  if (message) return message;
  return 'Please assist on the canvas';
}

export function createConductorRouter() {
  return { executeTask };
}
