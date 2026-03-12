import type {
  TimelineDependency,
  TimelineDocument,
  TimelineItem,
  TimelineItemStatus,
  TimelineLane,
  TimelineOp,
} from '@/lib/agents/timeline-schema';

export type TimelineTurnMode = 'patch' | 'plan' | 'noop';

export type TimelineReferenceMatch = {
  id: string;
  query: string;
  matchedBy: 'id' | 'exact' | 'alias' | 'token_subset';
  confidence: number;
};

export type TimelineEntityIndex = {
  lanes: Array<{
    id: string;
    name: string;
    normalized: string;
    aliases: string[];
  }>;
  items: Array<{
    id: string;
    title: string;
    normalized: string;
    laneId: string;
    status: TimelineItem['status'];
    owner?: string;
  }>;
  dependencies: Array<{
    id: string;
    fromItemId: string;
    toItemId: string;
    kind: TimelineDependency['kind'];
    label?: string;
  }>;
  recentEvents: Array<{
    id: string;
    source: string;
    summary?: string;
  }>;
};

export type TimelineActionIntent =
  | { type: 'set_meta'; field: 'title' | 'horizonLabel'; value: string }
  | { type: 'upsert_lane'; laneName: string }
  | { type: 'upsert_item'; itemTitle: string; itemType: TimelineItem['type']; laneName?: string }
  | { type: 'move_item'; itemId: string; laneId: string }
  | { type: 'set_status'; itemId: string; status: TimelineItem['status'] }
  | { type: 'set_dependency'; fromItemId: string; toItemId: string; kind: TimelineDependency['kind'] }
  | { type: 'delete_dependency'; dependencyId: string; targetItemId?: string; blockedByItemId?: string }
  | { type: 'annotate_item'; itemId: string; field: 'owner' | 'notes'; value: string }
  | { type: 'stage_export'; target: 'linear' | 'trello' | 'asana' | 'manual' };

export type TimelineTurnResolution = {
  mode: TimelineTurnMode;
  summary: string;
  ops: TimelineOp[];
  action?: TimelineActionIntent;
  reason?: string;
  fallbackContextBundle?: string;
};

const STATUS_ALIASES: Array<{ pattern: RegExp; status: TimelineItemStatus }> = [
  { pattern: /\bat risk\b/i, status: 'at_risk' },
  { pattern: /\bin progress\b|\bactive\b/i, status: 'in_progress' },
  { pattern: /\bblocked\b|\bstuck\b/i, status: 'blocked' },
  { pattern: /\bdone\b|\bcomplete(?:d)?\b|\bshipped\b/i, status: 'done' },
  { pattern: /\bplanned\b|\bbacklog\b/i, status: 'planned' },
];

const LANE_ALIAS_OVERRIDES: Record<string, string[]> = {
  product: ['product', 'prod'],
  engineering: ['engineering', 'eng', 'dev', 'platform'],
  'go to market': ['go to market', 'gtm', 'marketing', 'sales'],
  design: ['design', 'brand', 'ux'],
};

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (value: string) =>
  normalizeText(value)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';

const titleCase = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const stripWrappingQuotes = (value: string) => value.trim().replace(/^['"]+|['"]+$/g, '').trim();

const collectSignificantTokens = (value: string) =>
  normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const uniqueBy = <T>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const next = key(item);
    if (seen.has(next)) return false;
    seen.add(next);
    return true;
  });
};

const nextLaneOrder = (document: TimelineDocument) =>
  document.lanes.reduce((max, lane) => Math.max(max, lane.order), -1) + 1;

const nextUniqueItemId = (document: TimelineDocument, title: string, laneId: string) => {
  const base = `item-${slugify(`${laneId}-${title}`)}`;
  const existingIds = new Set(document.items.map((item) => item.id));
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
};

const summarizeDocument = (index: TimelineEntityIndex) => {
  const laneLine = index.lanes.length
    ? `Lanes: ${index.lanes.map((lane) => `${lane.id}:${lane.name}`).join('; ')}`
    : 'Lanes: (none)';
  const itemLine = index.items.length
    ? `Items: ${index.items
        .slice(0, 12)
        .map((item) => `${item.id}:${item.title} [${item.status}] lane=${item.laneId}${item.owner ? ` owner=${item.owner}` : ''}`)
        .join('; ')}`
    : 'Items: (none)';
  const dependencyLine = index.dependencies.length
    ? `Dependencies: ${index.dependencies
        .slice(0, 12)
        .map((dependency) => `${dependency.id}:${dependency.fromItemId}->${dependency.toItemId}:${dependency.kind}`)
        .join('; ')}`
    : 'Dependencies: (none)';
  return [laneLine, itemLine, dependencyLine].join('\n');
};

export function buildTimelineEntityIndex(document: TimelineDocument): TimelineEntityIndex {
  return {
    lanes: document.lanes.map((lane) => {
      const normalized = normalizeText(lane.name);
      const aliases = uniqueBy(
        [
          normalized,
          ...(LANE_ALIAS_OVERRIDES[normalized] ?? []),
          ...(normalizeText(lane.id) ? [normalizeText(lane.id)] : []),
        ].filter(Boolean),
        (value) => value,
      );
      return {
        id: lane.id,
        name: lane.name,
        normalized,
        aliases,
      };
    }),
    items: document.items.map((item) => ({
      id: item.id,
      title: item.title,
      normalized: normalizeText(item.title),
      laneId: item.laneId,
      status: item.status,
      owner: item.owner,
    })),
    dependencies: document.dependencies.map((dependency) => ({
      id: dependency.id,
      fromItemId: dependency.fromItemId,
      toItemId: dependency.toItemId,
      kind: dependency.kind,
      label: dependency.label,
    })),
    recentEvents: document.events.slice(-6).map((event) => ({
      id: event.id,
      source: event.source,
      summary: event.summary,
    })),
  };
}

const findLaneMatch = (query: string, index: TimelineEntityIndex) => {
  const trimmed = stripWrappingQuotes(query);
  const normalized = normalizeText(trimmed);
  if (!normalized) return { match: null as TimelineReferenceMatch | null, ambiguous: false };

  const byId = index.lanes.find((lane) => lane.id === trimmed || lane.id === normalized);
  if (byId) {
    return { match: { id: byId.id, query: trimmed, matchedBy: 'id', confidence: 1 }, ambiguous: false };
  }

  const exact = index.lanes.filter((lane) => lane.normalized === normalized || lane.aliases.includes(normalized));
  if (exact.length === 1) {
    return { match: { id: exact[0].id, query: trimmed, matchedBy: 'alias', confidence: 0.98 }, ambiguous: false };
  }
  if (exact.length > 1) {
    return { match: null, ambiguous: true };
  }

  const tokens = collectSignificantTokens(trimmed);
  if (tokens.length >= 1) {
    const subset = index.lanes.filter((lane) => tokens.every((token) => lane.aliases.some((alias) => alias.includes(token))));
    if (subset.length === 1) {
      return { match: { id: subset[0].id, query: trimmed, matchedBy: 'token_subset', confidence: 0.75 }, ambiguous: false };
    }
    if (subset.length > 1) {
      return { match: null, ambiguous: true };
    }
  }

  return { match: null, ambiguous: false };
};

const findItemMatch = (query: string, index: TimelineEntityIndex) => {
  const trimmed = stripWrappingQuotes(query);
  const normalized = normalizeText(trimmed);
  if (!normalized) return { match: null as TimelineReferenceMatch | null, ambiguous: false };

  const byId = index.items.find((item) => item.id === trimmed || item.id === normalized);
  if (byId) {
    return { match: { id: byId.id, query: trimmed, matchedBy: 'id', confidence: 1 }, ambiguous: false };
  }

  const exact = index.items.filter((item) => item.normalized === normalized);
  if (exact.length === 1) {
    return { match: { id: exact[0].id, query: trimmed, matchedBy: 'exact', confidence: 0.99 }, ambiguous: false };
  }
  if (exact.length > 1) {
    return { match: null, ambiguous: true };
  }

  const tokens = collectSignificantTokens(trimmed);
  if (tokens.length >= 2) {
    const subset = index.items.filter((item) => tokens.every((token) => item.normalized.includes(token)));
    if (subset.length === 1) {
      return { match: { id: subset[0].id, query: trimmed, matchedBy: 'token_subset', confidence: 0.8 }, ambiguous: false };
    }
    if (subset.length > 1) {
      return { match: null, ambiguous: true };
    }
  }

  return { match: null, ambiguous: false };
};

const detectStatus = (instruction: string) => {
  for (const candidate of STATUS_ALIASES) {
    if (candidate.pattern.test(instruction)) return candidate.status;
  }
  return null;
};

const buildFallbackContextBundle = (args: { instruction: string; reason: string; index: TimelineEntityIndex; contextBundle?: string }) =>
  [
    `Turn Resolution Fallback: ${args.reason}`,
    `Instruction: ${args.instruction}`,
    summarizeDocument(args.index),
    args.contextBundle ? `Prior Context Bundle:\n${args.contextBundle}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

const resolveDeleteDependency = (instruction: string, index: TimelineEntityIndex, document: TimelineDocument, now: number): TimelineTurnResolution | null => {
  const explicitRemoval = instruction.match(/^(?:remove|delete|clear) dependency (?:between|from) (.+?) and (.+)$/i);
  const noLongerDepends = instruction.match(/^(.+?) no longer depends on (.+)$/i);
  const parsed = explicitRemoval
    ? { targetRaw: explicitRemoval[1], blockerRaw: explicitRemoval[2] }
    : noLongerDepends
      ? { targetRaw: noLongerDepends[1], blockerRaw: noLongerDepends[2] }
      : null;
  if (!parsed) return null;

  const target = findItemMatch(parsed.targetRaw, index);
  const blocker = findItemMatch(parsed.blockerRaw, index);
  if (target.ambiguous || blocker.ambiguous) {
    return {
      mode: 'plan',
      summary: 'Timeline turn needs clarification before removing the dependency.',
      ops: [],
      reason: 'ambiguous_dependency_reference',
      fallbackContextBundle: buildFallbackContextBundle({
        instruction,
        reason: 'Ambiguous item reference while removing dependency.',
        index,
      }),
    };
  }
  if (!target.match || !blocker.match) return null;

  const dependency = document.dependencies.find(
    (entry) => entry.fromItemId === blocker.match!.id && entry.toItemId === target.match!.id,
  );
  if (!dependency) {
    return {
      mode: 'noop',
      summary: 'No matching dependency to remove.',
      ops: [],
      reason: 'dependency_missing',
    };
  }

  const targetItem = document.items.find((item) => item.id === target.match!.id);
  const blockedBy = Array.isArray(targetItem?.blockedBy)
    ? targetItem!.blockedBy.filter((itemId) => itemId !== blocker.match!.id)
    : [];

  return {
    mode: 'patch',
    summary: `Removed the dependency from ${targetItem?.title ?? target.match.id}.`,
    action: {
      type: 'delete_dependency',
      dependencyId: dependency.id,
      targetItemId: target.match.id,
      blockedByItemId: blocker.match.id,
    },
    ops: [
      { type: 'delete_dependency', dependencyId: dependency.id },
      ...(targetItem
        ? [
            {
              type: 'upsert_item' as const,
              item: {
                ...targetItem,
                blockedBy,
                updatedAt: now,
              },
            },
          ]
        : []),
    ],
  };
};

const resolveStageExport = (instruction: string, now: number): TimelineTurnResolution | null => {
  const match = instruction.match(/(?:stage|queue|prepare) (?:an? )?export (?:to|for) (linear|trello|asana|manual)/i);
  if (!match) return null;
  const target = match[1].toLowerCase() as 'linear' | 'trello' | 'asana' | 'manual';
  return {
    mode: 'patch',
    summary: `Queued a staged export for ${target}.`,
    action: { type: 'stage_export', target },
    ops: [
      {
        type: 'stage_export' as const,
        exportStage: {
          id: `export-${target}`,
          target,
          status: 'queued' as const,
          summary: `Export queued from timeline.turn.`,
          queuedAt: now,
          updatedAt: now,
        },
      },
    ],
  };
};

const resolveSetMeta = (instruction: string): TimelineTurnResolution | null => {
  const rename = instruction.match(/^(?:rename timeline to|call this timeline|call this)\s+(.+)$/i);
  if (rename) {
    const value = stripWrappingQuotes(rename[1]);
    if (!value) return null;
    return {
      mode: 'patch',
      summary: `Renamed the timeline to ${value}.`,
      action: { type: 'set_meta', field: 'title', value },
      ops: [{ type: 'set_meta', title: value }],
    };
  }
  const horizon = instruction.match(/^(?:set|change|update) horizon(?: label)? to\s+(.+)$/i);
  if (horizon) {
    const value = stripWrappingQuotes(horizon[1]);
    if (!value) return null;
    return {
      mode: 'patch',
      summary: `Updated the timeline horizon to ${value}.`,
      action: { type: 'set_meta', field: 'horizonLabel', value },
      ops: [{ type: 'set_meta', horizonLabel: value }],
    };
  }
  return null;
};

const resolveUpsertLane = (instruction: string, document: TimelineDocument): TimelineTurnResolution | null => {
  const match = instruction.match(/^(?:add|create) (?:a |an )?(.+?) lane$/i);
  if (!match) return null;
  const laneName = titleCase(stripWrappingQuotes(match[1]));
  if (!laneName) return null;
  return {
    mode: 'patch',
    summary: `Added the ${laneName} lane.`,
    action: { type: 'upsert_lane', laneName },
    ops: [
      {
        type: 'upsert_lane' as const,
        lane: {
          id: `lane-${slugify(laneName)}`,
          name: laneName,
          kind: 'team',
          order: nextLaneOrder(document),
        },
      },
    ],
  };
};

const resolveUpsertItem = (
  instruction: string,
  document: TimelineDocument,
  index: TimelineEntityIndex,
  now: number,
): TimelineTurnResolution | null => {
  const match = instruction.match(
    /^(?:add|create) (?:a |an )?(milestone|task|sprint|decision|blocker|handoff)\s+(.+?)(?:\s+(?:to|in|on)\s+(?:the\s+)??(.+?)(?:\s+lane)?)?$/i,
  );
  if (!match) return null;
  const itemType = match[1].toLowerCase() as TimelineItem['type'];
  const title = titleCase(stripWrappingQuotes(match[2]));
  const laneQuery = typeof match[3] === 'string' ? match[3].trim() : '';
  if (!title) return null;

  const laneMatch = laneQuery ? findLaneMatch(laneQuery, index) : { match: null, ambiguous: false };
  if (laneMatch.ambiguous) {
    return {
      mode: 'plan',
      summary: 'Timeline turn needs clarification before adding the item.',
      ops: [],
      reason: 'ambiguous_lane_reference',
      fallbackContextBundle: buildFallbackContextBundle({
        instruction,
        reason: 'Ambiguous lane while adding item.',
        index,
      }),
    };
  }
  const laneId = laneMatch.match?.id ?? document.lanes[0]?.id ?? 'lane-product';
  const existing = document.items.find(
    (item) =>
      item.laneId === laneId &&
      item.type === itemType &&
      normalizeText(item.title) === normalizeText(title),
  );
  const itemId = existing?.id ?? nextUniqueItemId(document, title, laneId);
  const current = existing ?? null;

  return {
    mode: 'patch',
    summary: `${current ? 'Updated' : 'Added'} ${title}.`,
    action: { type: 'upsert_item', itemTitle: title, itemType, laneName: laneQuery || undefined },
    ops: [
      {
        type: 'upsert_item' as const,
        item: {
          ...(current ?? {
            id: itemId,
            laneId,
            title,
            type: itemType,
            status: itemType === 'blocker' ? 'blocked' : 'planned',
            tags: [],
            blockedBy: [],
            createdAt: now,
          }),
          laneId,
          title,
          type: itemType,
          updatedAt: now,
        },
      },
    ],
  };
};

const resolveMoveItem = (
  instruction: string,
  document: TimelineDocument,
  index: TimelineEntityIndex,
  now: number,
): TimelineTurnResolution | null => {
  const match = instruction.match(/^(?:move|put|shift)\s+(.+?)\s+to\s+(?:the\s+)?(.+?)(?:\s+lane)?$/i);
  if (!match) return null;
  const itemResult = findItemMatch(match[1], index);
  const laneResult = findLaneMatch(match[2], index);
  if (itemResult.ambiguous || laneResult.ambiguous) {
    return {
      mode: 'plan',
      summary: 'Timeline turn needs clarification before moving the item.',
      ops: [],
      reason: 'ambiguous_move_reference',
      fallbackContextBundle: buildFallbackContextBundle({
        instruction,
        reason: 'Ambiguous item or lane while moving an item.',
        index,
      }),
    };
  }
  if (!itemResult.match || !laneResult.match) return null;
  const item = document.items.find((entry) => entry.id === itemResult.match!.id);
  if (!item) return null;
  if (item.laneId === laneResult.match.id) {
    return { mode: 'noop', summary: `${item.title} is already in that lane.`, ops: [], reason: 'already_in_lane' };
  }
  return {
    mode: 'patch',
    summary: `Moved ${item.title} to ${document.lanes.find((lane) => lane.id === laneResult.match!.id)?.name ?? laneResult.match.id}.`,
    action: { type: 'move_item', itemId: item.id, laneId: laneResult.match.id },
    ops: [
      {
        type: 'upsert_item' as const,
        item: {
          ...item,
          laneId: laneResult.match.id,
          updatedAt: now,
        },
      },
    ],
  };
};

const resolveSetStatus = (
  instruction: string,
  document: TimelineDocument,
  index: TimelineEntityIndex,
  now: number,
): TimelineTurnResolution | null => {
  const status = detectStatus(instruction);
  if (!status) return null;
  const patterns = [
    /^(?:mark|set)\s+(.+?)\s+(?:as\s+|to\s+)?(?:at risk|in progress|blocked|done|planned|active|stuck|completed|complete|shipped|backlog)$/i,
    /^(.+?)\s+(?:is|should be)\s+(?:at risk|in progress|blocked|done|planned|active|stuck|completed|complete|shipped|backlog)$/i,
  ];
  const match = patterns.map((pattern) => instruction.match(pattern)).find(Boolean);
  if (!match) return null;
  const itemResult = findItemMatch(match[1], index);
  if (itemResult.ambiguous) {
    return {
      mode: 'plan',
      summary: 'Timeline turn needs clarification before changing status.',
      ops: [],
      reason: 'ambiguous_status_reference',
      fallbackContextBundle: buildFallbackContextBundle({
        instruction,
        reason: 'Ambiguous item while changing status.',
        index,
      }),
    };
  }
  if (!itemResult.match) return null;
  const item = document.items.find((entry) => entry.id === itemResult.match!.id);
  if (!item) return null;
  if (item.status === status) {
    return { mode: 'noop', summary: `${item.title} is already ${status.replace('_', ' ')}.`, ops: [], reason: 'status_unchanged' };
  }
  return {
    mode: 'patch',
    summary: `Marked ${item.title} ${status.replace('_', ' ')}.`,
    action: { type: 'set_status', itemId: item.id, status },
    ops: [
      {
        type: 'upsert_item' as const,
        item: {
          ...item,
          status,
          updatedAt: now,
        },
      },
    ],
  };
};

const resolveSetDependency = (
  instruction: string,
  document: TimelineDocument,
  index: TimelineEntityIndex,
  now: number,
): TimelineTurnResolution | null => {
  const dependsMatch = instruction.match(/^(.+?)\s+depends on\s+(.+)$/i);
  const blockedByMatch = instruction.match(/^(.+?)\s+(?:is\s+)?blocked by\s+(.+)$/i);
  const handoffMatch = instruction.match(/^handoff\s+(.+?)\s+to\s+(.+)$/i);
  const parsed = dependsMatch
    ? { targetRaw: dependsMatch[1], sourceRaw: dependsMatch[2], kind: 'depends_on' as const }
    : blockedByMatch
      ? { targetRaw: blockedByMatch[1], sourceRaw: blockedByMatch[2], kind: 'blocks' as const }
      : handoffMatch
        ? { targetRaw: handoffMatch[2], sourceRaw: handoffMatch[1], kind: 'handoff' as const }
        : null;
  if (!parsed) return null;

  const target = findItemMatch(parsed.targetRaw, index);
  const source = findItemMatch(parsed.sourceRaw, index);
  if (target.ambiguous || source.ambiguous) {
    return {
      mode: 'plan',
      summary: 'Timeline turn needs clarification before setting the dependency.',
      ops: [],
      reason: 'ambiguous_dependency_reference',
      fallbackContextBundle: buildFallbackContextBundle({
        instruction,
        reason: 'Ambiguous item reference while setting dependency.',
        index,
      }),
    };
  }
  if (!target.match || !source.match) return null;

  const targetItem = document.items.find((item) => item.id === target.match!.id);
  const dependencyId = `dep-${source.match.id}-${target.match.id}-${parsed.kind}`;
  const dependency = {
    id: dependencyId,
    fromItemId: source.match.id,
    toItemId: target.match.id,
    kind: parsed.kind,
    label:
      parsed.kind === 'handoff'
        ? 'handoff'
        : parsed.kind === 'blocks'
          ? 'blocked by'
          : 'depends on',
  } satisfies TimelineDependency;
  const blockedBy =
    parsed.kind === 'handoff' || !targetItem
      ? null
      : uniqueBy([...(targetItem.blockedBy ?? []), source.match.id], (value) => value);
  const nextStatus =
    parsed.kind === 'blocks' && targetItem && targetItem.status !== 'done'
      ? 'blocked'
      : targetItem?.status;

  return {
    mode: 'patch',
    summary: `Linked ${targetItem?.title ?? target.match.id} to ${document.items.find((item) => item.id === source.match!.id)?.title ?? source.match.id}.`,
    action: {
      type: 'set_dependency',
      fromItemId: source.match.id,
      toItemId: target.match.id,
      kind: parsed.kind,
    },
    ops: [
      { type: 'set_dependency', dependency },
      ...(blockedBy && targetItem
        ? [
            {
              type: 'upsert_item' as const,
              item: {
                ...targetItem,
                blockedBy,
                status: nextStatus ?? 'planned',
                updatedAt: now,
              },
            },
          ]
        : []),
    ],
  };
};

const resolveAnnotateItem = (
  instruction: string,
  document: TimelineDocument,
  index: TimelineEntityIndex,
  now: number,
): TimelineTurnResolution | null => {
  const assignMatch = instruction.match(/^assign\s+(.+?)\s+to\s+(.+)$/i);
  if (assignMatch) {
    const itemResult = findItemMatch(assignMatch[1], index);
    if (itemResult.ambiguous) {
      return {
        mode: 'plan',
        summary: 'Timeline turn needs clarification before assigning the item.',
        ops: [],
        reason: 'ambiguous_assignment_reference',
        fallbackContextBundle: buildFallbackContextBundle({
          instruction,
          reason: 'Ambiguous item while assigning owner.',
          index,
        }),
      };
    }
    if (!itemResult.match) return null;
    const item = document.items.find((entry) => entry.id === itemResult.match!.id);
    if (!item) return null;
    const owner = stripWrappingQuotes(assignMatch[2]);
    if (!owner) return null;
    return {
      mode: 'patch',
      summary: `Assigned ${item.title} to ${owner}.`,
      action: { type: 'annotate_item', itemId: item.id, field: 'owner', value: owner },
      ops: [
        {
          type: 'upsert_item' as const,
          item: {
            ...item,
            owner,
            updatedAt: now,
          },
        },
      ],
    };
  }

  const noteMatch = instruction.match(/^add note\s+(.+?)\s+to\s+(.+)$/i);
  if (noteMatch) {
    const itemResult = findItemMatch(noteMatch[2], index);
    if (itemResult.ambiguous) {
      return {
        mode: 'plan',
        summary: 'Timeline turn needs clarification before adding the note.',
        ops: [],
        reason: 'ambiguous_note_reference',
        fallbackContextBundle: buildFallbackContextBundle({
          instruction,
          reason: 'Ambiguous item while adding note.',
          index,
        }),
      };
    }
    if (!itemResult.match) return null;
    const item = document.items.find((entry) => entry.id === itemResult.match!.id);
    if (!item) return null;
    const note = stripWrappingQuotes(noteMatch[1]);
    if (!note) return null;
    return {
      mode: 'patch',
      summary: `Added a note to ${item.title}.`,
      action: { type: 'annotate_item', itemId: item.id, field: 'notes', value: note },
      ops: [
        {
          type: 'upsert_item' as const,
          item: {
            ...item,
            notes: item.notes ? `${item.notes}\n${note}` : note,
            updatedAt: now,
          },
        },
      ],
    };
  }

  return null;
};

export async function resolveTimelineTurn(params: {
  instruction?: string;
  document: TimelineDocument;
  contextBundle?: string;
  now?: number;
}): Promise<TimelineTurnResolution> {
  const instruction = params.instruction?.trim() || '';
  const now = typeof params.now === 'number' ? params.now : Date.now();
  const index = buildTimelineEntityIndex(params.document);

  if (!instruction) {
    return {
      mode: 'noop',
      summary: 'No timeline update requested.',
      ops: [],
      reason: 'empty_instruction',
    };
  }

  const deterministicResolvers = [
    () => resolveStageExport(instruction, now),
    () => resolveSetMeta(instruction),
    () => resolveDeleteDependency(instruction, index, params.document, now),
    () => resolveSetDependency(instruction, params.document, index, now),
    () => resolveMoveItem(instruction, params.document, index, now),
    () => resolveSetStatus(instruction, params.document, index, now),
    () => resolveAnnotateItem(instruction, params.document, index, now),
    () => resolveUpsertItem(instruction, params.document, index, now),
    () => resolveUpsertLane(instruction, params.document),
  ];

  for (const resolver of deterministicResolvers) {
    const result = resolver();
    if (result) return result;
  }

  return {
    mode: 'plan',
    summary: instruction.slice(0, 180) || 'Timeline update requested.',
    ops: [],
    reason: 'requires_planner',
    fallbackContextBundle: buildFallbackContextBundle({
      instruction,
      reason: 'No deterministic timeline.turn pattern matched.',
      index,
      contextBundle: params.contextBundle,
    }),
  };
}
