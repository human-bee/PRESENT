import { z } from 'zod';

export const timelineSourceEnum = z.enum(['voice', 'webhook', 'form', 'tool', 'manual', 'system']);
export const timelineLaneKindEnum = z.enum(['team', 'workstream', 'horizon']);
export const timelineItemTypeEnum = z.enum([
  'milestone',
  'task',
  'sprint',
  'decision',
  'blocker',
  'handoff',
]);
export const timelineItemStatusEnum = z.enum([
  'planned',
  'in_progress',
  'blocked',
  'at_risk',
  'done',
]);
export const timelineDependencyKindEnum = z.enum(['blocks', 'depends_on', 'handoff']);
export const timelineExportTargetEnum = z.enum(['linear', 'trello', 'asana', 'manual']);
export const timelineSyncStatusEnum = z.enum(['idle', 'live', 'staged', 'error']);

export const timelineLaneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: timelineLaneKindEnum.default('team'),
  order: z.number().int().default(0),
  color: z.string().optional(),
  owner: z.string().optional(),
});

export const timelineItemSchema = z.object({
  id: z.string().min(1),
  laneId: z.string().min(1),
  title: z.string().min(1),
  type: timelineItemTypeEnum.default('task'),
  status: timelineItemStatusEnum.default('planned'),
  owner: z.string().optional(),
  summary: z.string().optional(),
  notes: z.string().optional(),
  sprintLabel: z.string().optional(),
  startLabel: z.string().optional(),
  dueLabel: z.string().optional(),
  tags: z.array(z.string().min(1)).default([]),
  blockedBy: z.array(z.string().min(1)).default([]),
  sourceEventId: z.string().optional(),
  createdAt: z.number().int().nonnegative().default(0),
  updatedAt: z.number().int().nonnegative().default(0),
});

export const timelineDependencySchema = z.object({
  id: z.string().min(1),
  fromItemId: z.string().min(1),
  toItemId: z.string().min(1),
  kind: timelineDependencyKindEnum.default('blocks'),
  label: z.string().optional(),
});

export const timelineSourceEventSchema = z.object({
  id: z.string().min(1),
  source: timelineSourceEnum.default('system'),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  intentId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  summary: z.string().optional(),
  createdAt: z.number().int().nonnegative().default(0),
});

export const timelineExportStageSchema = z.object({
  id: z.string().min(1),
  target: timelineExportTargetEnum,
  status: z.enum(['pending', 'queued', 'synced', 'error']).default('pending'),
  summary: z.string().optional(),
  queuedAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export const timelineSyncStateSchema = z.object({
  status: timelineSyncStatusEnum.default('idle'),
  lastSyncedAt: z.number().int().nonnegative().optional(),
  lastError: z.string().optional(),
  retryMs: z.number().int().nonnegative().optional(),
  pendingExports: z.array(timelineExportStageSchema).default([]),
});

export const timelineDocumentSchema = z.object({
  componentId: z.string().min(1),
  title: z.string().default('Project Timeline'),
  subtitle: z.string().default('Live roadmap for dependencies, risks, and sprint flow.'),
  horizonLabel: z.string().default('Current planning horizon'),
  lanes: z.array(timelineLaneSchema).default([]),
  items: z.array(timelineItemSchema).default([]),
  dependencies: z.array(timelineDependencySchema).default([]),
  events: z.array(timelineSourceEventSchema).default([]),
  sync: timelineSyncStateSchema.default({
    status: 'idle',
    pendingExports: [],
  }),
  version: z.number().int().nonnegative().default(0),
  lastUpdated: z.number().int().nonnegative().default(0),
});

export type TimelineDocument = z.infer<typeof timelineDocumentSchema>;
export type TimelineLane = z.infer<typeof timelineLaneSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type TimelineItemStatus = z.infer<typeof timelineItemStatusEnum>;
export type TimelineDependency = z.infer<typeof timelineDependencySchema>;
export type TimelineSourceEvent = z.infer<typeof timelineSourceEventSchema>;
export type TimelineExportStage = z.infer<typeof timelineExportStageSchema>;
export type TimelineSyncState = z.infer<typeof timelineSyncStateSchema>;

export const timelineOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_meta'),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    horizonLabel: z.string().optional(),
  }),
  z.object({
    type: z.literal('upsert_lane'),
    lane: timelineLaneSchema,
  }),
  z.object({
    type: z.literal('upsert_item'),
    item: timelineItemSchema,
  }),
  z.object({
    type: z.literal('delete_item'),
    itemId: z.string().min(1),
  }),
  z.object({
    type: z.literal('set_dependency'),
    dependency: timelineDependencySchema,
  }),
  z.object({
    type: z.literal('delete_dependency'),
    dependencyId: z.string().min(1),
  }),
  z.object({
    type: z.literal('append_event'),
    event: timelineSourceEventSchema,
  }),
  z.object({
    type: z.literal('set_sync_state'),
    sync: timelineSyncStateSchema,
  }),
  z.object({
    type: z.literal('stage_export'),
    exportStage: timelineExportStageSchema,
  }),
]);

export type TimelineOp = z.infer<typeof timelineOpSchema>;

const uniqueById = <T extends { id: string }>(items: T[]): T[] => {
  const byId = new Map<string, T>();
  items.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
};

const sortLanes = (lanes: TimelineLane[]) =>
  lanes.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

const sortItems = (items: TimelineItem[]) =>
  items
    .slice()
    .sort((a, b) => {
      const aLane = a.laneId.localeCompare(b.laneId);
      if (aLane !== 0) return aLane;
      const aDate = (a.dueLabel || a.startLabel || '').localeCompare(b.dueLabel || b.startLabel || '');
      if (aDate !== 0) return aDate;
      const aUpdated = (a.updatedAt || 0) - (b.updatedAt || 0);
      if (aUpdated !== 0) return aUpdated;
      return a.title.localeCompare(b.title);
    });

const sortDependencies = (dependencies: TimelineDependency[]) =>
  dependencies
    .slice()
    .sort((a, b) => `${a.fromItemId}:${a.toItemId}:${a.kind}`.localeCompare(`${b.fromItemId}:${b.toItemId}:${b.kind}`));

const sortEvents = (events: TimelineSourceEvent[]) =>
  events.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

export function createDefaultTimelineDocument(componentId: string, title?: string): TimelineDocument {
  const now = Date.now();
  return timelineDocumentSchema.parse({
    componentId,
    title: title?.trim() || 'Project Timeline',
    subtitle: 'Live roadmap for dependencies, risks, and sprint flow.',
    horizonLabel: 'Current planning horizon',
    lanes: [
      { id: 'lane-product', name: 'Product', kind: 'team', order: 0, color: '#5fb0ff' },
      { id: 'lane-engineering', name: 'Engineering', kind: 'team', order: 1, color: '#4fd39f' },
      { id: 'lane-go-to-market', name: 'Go To Market', kind: 'team', order: 2, color: '#f7b955' },
    ],
    items: [],
    dependencies: [],
    events: [],
    sync: { status: 'idle', pendingExports: [] },
    version: 0,
    lastUpdated: now,
  });
}

export function normalizeTimelineDocument(input: TimelineDocument): TimelineDocument {
  return timelineDocumentSchema.parse({
    ...input,
    lanes: sortLanes(uniqueById(input.lanes || [])),
    items: sortItems(uniqueById(input.items || [])),
    dependencies: sortDependencies(uniqueById(input.dependencies || [])),
    events: sortEvents(uniqueById((input.events || []).slice(-48))),
    sync: timelineSyncStateSchema.parse({
      ...input.sync,
      pendingExports: uniqueById(input.sync?.pendingExports || []),
    }),
  });
}

export function applyTimelineOps(current: TimelineDocument, ops: TimelineOp[]): TimelineDocument {
  const next: TimelineDocument = JSON.parse(JSON.stringify(current));

  for (const op of ops) {
    switch (op.type) {
      case 'set_meta': {
        if (typeof op.title === 'string' && op.title.trim()) next.title = op.title.trim();
        if (typeof op.subtitle === 'string' && op.subtitle.trim()) next.subtitle = op.subtitle.trim();
        if (typeof op.horizonLabel === 'string' && op.horizonLabel.trim()) {
          next.horizonLabel = op.horizonLabel.trim();
        }
        break;
      }
      case 'upsert_lane': {
        const idx = next.lanes.findIndex((lane) => lane.id === op.lane.id);
        if (idx >= 0) {
          next.lanes[idx] = { ...next.lanes[idx], ...op.lane };
        } else {
          next.lanes.push(op.lane);
        }
        break;
      }
      case 'upsert_item': {
        const idx = next.items.findIndex((item) => item.id === op.item.id);
        if (idx >= 0) {
          next.items[idx] = { ...next.items[idx], ...op.item };
        } else {
          next.items.push(op.item);
        }
        break;
      }
      case 'delete_item': {
        next.items = next.items.filter((item) => item.id !== op.itemId);
        next.items = next.items.map((item) => ({
          ...item,
          blockedBy: Array.isArray(item.blockedBy)
            ? item.blockedBy.filter((blockedId) => blockedId !== op.itemId)
            : [],
        }));
        next.dependencies = next.dependencies.filter(
          (dependency) => dependency.fromItemId !== op.itemId && dependency.toItemId !== op.itemId,
        );
        break;
      }
      case 'set_dependency': {
        const idx = next.dependencies.findIndex((dependency) => dependency.id === op.dependency.id);
        if (idx >= 0) {
          next.dependencies[idx] = { ...next.dependencies[idx], ...op.dependency };
        } else {
          next.dependencies.push(op.dependency);
        }
        break;
      }
      case 'delete_dependency': {
        next.dependencies = next.dependencies.filter((dependency) => dependency.id !== op.dependencyId);
        break;
      }
      case 'append_event': {
        next.events = [...next.events, op.event];
        break;
      }
      case 'set_sync_state': {
        next.sync = { ...next.sync, ...op.sync };
        break;
      }
      case 'stage_export': {
        const idx = next.sync.pendingExports.findIndex((stage) => stage.id === op.exportStage.id);
        if (idx >= 0) {
          next.sync.pendingExports[idx] = {
            ...next.sync.pendingExports[idx],
            ...op.exportStage,
          };
        } else {
          next.sync.pendingExports.push(op.exportStage);
        }
        next.sync.status = op.exportStage.status === 'error' ? 'error' : 'staged';
        break;
      }
      default:
        break;
    }
  }

  next.lastUpdated = Date.now();
  return normalizeTimelineDocument(next);
}
