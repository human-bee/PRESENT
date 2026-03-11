import { z } from 'zod';
import type { JsonObject, JsonValue } from '@/lib/utils/json-schema';
import {
  broadcastToolCall,
  commitTimelineDocument,
  getTimelineDocument,
} from '@/lib/agents/shared/supabase-context';
import { createLogger } from '@/lib/logging';
import { runTimelineStewardFast } from '@/lib/agents/subagents/timeline-steward-fast';
import { resolveTimelineTurn } from '@/lib/agents/subagents/timeline-turn-resolver';
import {
  timelineOpSchema,
  timelineSourceEnum,
  type TimelineDocument,
  type TimelineOp,
} from '@/lib/agents/timeline-schema';

export const TimelineTaskArgs = z
  .object({
    room: z.string().min(1, 'room is required'),
    componentId: z.string().min(1, 'componentId is required'),
    intent: z.string().optional(),
    summary: z.string().optional(),
    prompt: z.string().optional(),
    instruction: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    horizonLabel: z.string().optional(),
    contextBundle: z.string().optional(),
    source: timelineSourceEnum.optional(),
    ops: z.array(timelineOpSchema).optional(),
    requestId: z.string().optional(),
    traceId: z.string().optional(),
    intentId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    contextProfile: z.string().optional(),
  })
  .passthrough();

export type TimelineTaskInput = z.infer<typeof TimelineTaskArgs>;

export const TIMELINE_RESOURCE_URI = '/mcp-apps/timeline.html';
export const DEFAULT_TIMELINE_SYNC_INTERVAL_MS = 2500;

const logger = createLogger('timeline-task-runner');

export const buildTimelineWidgetPatch = (args: {
  room: string;
  componentId: string;
  document?: TimelineDocument;
  syncStatus?: 'idle' | 'live' | 'staged' | 'error';
  syncError?: string | null;
}): JsonObject => {
  const exportStages = Array.isArray(args.document?.sync?.pendingExports)
    ? args.document!.sync.pendingExports
    : [];
  const refreshKey =
    args.document && typeof args.document.version === 'number'
      ? `timeline:${args.document.version}:${args.document.lastUpdated ?? 0}`
      : `timeline:init:${args.componentId}`;
  return {
    title: args.document?.title ?? 'Live Roadmap',
    resourceUri: TIMELINE_RESOURCE_URI,
    syncSource: 'timeline',
    syncRoom: args.room,
    syncComponentId: args.componentId,
    syncIntervalMs: DEFAULT_TIMELINE_SYNC_INTERVAL_MS,
    autoRun: false,
    args: {
      room: args.room,
      componentId: args.componentId,
      timelineTitle: args.document?.title ?? 'Live Roadmap',
      timelineSubtitle:
        args.document?.subtitle ?? 'Realtime planning surface for teams, risks, and milestones.',
      timelineVersion: args.document?.version ?? 0,
      timelineLastUpdated: args.document?.lastUpdated ?? Date.now(),
      timelineRefreshKey: refreshKey,
      timelineSyncStatus: args.syncStatus ?? args.document?.sync?.status ?? 'idle',
      timelineSyncError: args.syncError ?? null,
      timelinePendingExportCount: exportStages.length,
      timelineExportStages: exportStages as unknown as JsonValue,
      timelineSyncState: args.document?.sync?.status ?? args.syncStatus ?? 'idle',
    },
  };
};

export async function broadcastTimelineWidgetRefresh(args: {
  room: string;
  componentId: string;
  document: TimelineDocument;
  syncError?: string | null;
}) {
  await broadcastToolCall({
    room: args.room,
    tool: 'update_component',
    params: {
      componentId: args.componentId,
      patch: buildTimelineWidgetPatch({
        room: args.room,
        componentId: args.componentId,
        document: args.document,
        syncStatus: args.document.sync?.status ?? 'live',
        syncError: args.syncError ?? null,
      }),
    },
  });
}

const summarizeTimelineInstruction = (parsed: TimelineTaskInput) =>
  parsed.instruction?.trim() || parsed.prompt?.trim() || parsed.summary?.trim() || 'Timeline updated.';

async function commitAndBroadcastTimelineOps(args: {
  room: string;
  componentId: string;
  baseVersion?: number;
  ops: TimelineOp[];
}) {
  const committed = await commitTimelineDocument(args.room, args.componentId, {
    ops: args.ops,
    prevVersion: args.baseVersion,
    componentType: 'McpAppWidget',
  });
  await broadcastTimelineWidgetRefresh({
    room: args.room,
    componentId: args.componentId,
    document: committed.document,
  });
  return committed;
}

export async function runTimelinePatchTask(parsed: TimelineTaskInput) {
  const record = await getTimelineDocument(parsed.room, parsed.componentId);
  const now = Date.now();
  const summary = summarizeTimelineInstruction(parsed);
  const source = parsed.source ?? 'manual';
  const parsedIdempotencyKey =
    typeof parsed.idempotencyKey === 'string' && parsed.idempotencyKey.trim().length > 0
      ? parsed.idempotencyKey.trim()
      : null;
  const duplicateEvent = parsedIdempotencyKey
    ? record.document.events.find((event) => event.idempotencyKey === parsedIdempotencyKey)
    : null;
  if (duplicateEvent) {
    await broadcastTimelineWidgetRefresh({
      room: parsed.room,
      componentId: parsed.componentId,
      document: record.document,
    });
    return {
      status: 'deduped',
      version: record.version,
      summary: duplicateEvent.summary ?? summary,
    };
  }
  const hasAppendEvent = Array.isArray(parsed.ops)
    ? parsed.ops.some((op) => op.type === 'append_event')
    : false;
  const hasMetaUpdate = Array.isArray(parsed.ops)
    ? parsed.ops.some((op) => op.type === 'set_meta')
    : false;
  const hasSyncOverride = Array.isArray(parsed.ops)
    ? parsed.ops.some((op) => op.type === 'set_sync_state' || op.type === 'stage_export')
    : false;
  const ops: TimelineOp[] = [
    ...(!hasMetaUpdate
      ? [{
          type: 'set_meta' as const,
          title: typeof parsed.title === 'string' ? parsed.title : undefined,
          subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
          horizonLabel: typeof parsed.horizonLabel === 'string' ? parsed.horizonLabel : undefined,
        }]
      : []),
    ...(!hasSyncOverride
      ? [{
          type: 'set_sync_state' as const,
          sync: {
            ...record.document.sync,
            status: 'live',
            lastSyncedAt: now,
            lastError: undefined,
            retryMs: undefined,
            pendingExports: record.document.sync?.pendingExports ?? [],
          },
        }]
      : []),
    ...(Array.isArray(parsed.ops) ? parsed.ops : []),
    ...(!hasAppendEvent
      ? [{
          type: 'append_event' as const,
          event: {
            id: `evt-${now}`,
            source,
            requestId: parsed.requestId,
            traceId: parsed.traceId,
            intentId: parsed.intentId,
            idempotencyKey: parsedIdempotencyKey ?? undefined,
            summary: summary.slice(0, 200),
            createdAt: now,
          },
        }]
      : []),
  ];

  const committed = await commitAndBroadcastTimelineOps({
    room: parsed.room,
    componentId: parsed.componentId,
    baseVersion: record.version,
    ops,
  });

  logger.info('timeline.patch committed', {
    room: parsed.room,
    componentId: parsed.componentId,
    version: committed.version,
    source,
  });

  return {
    status: 'ok',
    version: committed.version,
    summary,
  };
}

export async function runTimelineRunTask(parsed: TimelineTaskInput) {
  const instruction = summarizeTimelineInstruction(parsed);
  const record = await getTimelineDocument(parsed.room, parsed.componentId);
  const result = await runTimelineStewardFast({
    room: parsed.room,
    componentId: parsed.componentId,
    instruction,
    source: parsed.source ?? 'manual',
    document: record.document,
    contextBundle:
      typeof parsed.contextBundle === 'string' && parsed.contextBundle.trim().length > 0
        ? parsed.contextBundle.trim()
        : undefined,
    contextProfile:
      typeof parsed.contextProfile === 'string' ? parsed.contextProfile : undefined,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
    horizonLabel: typeof parsed.horizonLabel === 'string' ? parsed.horizonLabel : undefined,
    requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined,
    traceId: typeof parsed.traceId === 'string' ? parsed.traceId : undefined,
    intentId: typeof parsed.intentId === 'string' ? parsed.intentId : undefined,
    idempotencyKey:
      typeof parsed.idempotencyKey === 'string' && parsed.idempotencyKey.trim().length > 0
        ? parsed.idempotencyKey.trim()
        : undefined,
  });
  const enriched: TimelineTaskInput = {
    ...parsed,
    summary: result.summary,
    instruction,
    source: parsed.source ?? 'voice',
    ops: [...(Array.isArray(parsed.ops) ? parsed.ops : []), ...result.ops],
  };
  return runTimelinePatchTask(enriched);
}

export async function runTimelineTurnTask(parsed: TimelineTaskInput) {
  const instruction = summarizeTimelineInstruction(parsed);
  const record = await getTimelineDocument(parsed.room, parsed.componentId);
  const resolution = await resolveTimelineTurn({
    instruction,
    document: record.document,
    contextBundle:
      typeof parsed.contextBundle === 'string' && parsed.contextBundle.trim().length > 0
        ? parsed.contextBundle.trim()
        : undefined,
  });

  if (resolution.mode === 'noop') {
    await broadcastTimelineWidgetRefresh({
      room: parsed.room,
      componentId: parsed.componentId,
      document: record.document,
    });
    return {
      status: 'noop',
      version: record.version,
      summary: resolution.summary,
    };
  }

  if (resolution.mode === 'patch' && resolution.ops.length > 0) {
    const enriched: TimelineTaskInput = {
      ...parsed,
      summary: resolution.summary,
      instruction,
      source: parsed.source ?? 'voice',
      ops: [...(Array.isArray(parsed.ops) ? parsed.ops : []), ...resolution.ops],
    };
    return runTimelinePatchTask(enriched);
  }

  const result = await runTimelineStewardFast({
    room: parsed.room,
    componentId: parsed.componentId,
    instruction,
    source: parsed.source ?? 'manual',
    document: record.document,
    contextBundle: resolution.fallbackContextBundle ?? parsed.contextBundle,
    contextProfile:
      typeof parsed.contextProfile === 'string' ? parsed.contextProfile : undefined,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
    horizonLabel: typeof parsed.horizonLabel === 'string' ? parsed.horizonLabel : undefined,
    requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined,
    traceId: typeof parsed.traceId === 'string' ? parsed.traceId : undefined,
    intentId: typeof parsed.intentId === 'string' ? parsed.intentId : undefined,
    idempotencyKey:
      typeof parsed.idempotencyKey === 'string' && parsed.idempotencyKey.trim().length > 0
        ? parsed.idempotencyKey.trim()
        : undefined,
  });
  const enriched: TimelineTaskInput = {
    ...parsed,
    summary: result.summary,
    instruction,
    source: parsed.source ?? 'voice',
    ops: [...(Array.isArray(parsed.ops) ? parsed.ops : []), ...result.ops],
  };
  return runTimelinePatchTask(enriched);
}
