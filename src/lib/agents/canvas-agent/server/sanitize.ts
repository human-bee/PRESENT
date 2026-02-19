import type { AgentAction } from '@/lib/canvas-agent/contract/types';
import { actionParamSchemas } from '@/lib/canvas-agent/contract/parsers';
import { newAgentShapeId } from '@/lib/canvas-agent/contract/ids';
import { resolveShapeType, sanitizeShapeProps } from '@/lib/canvas-agent/contract/shape-utils';
import { CLEAR_ALL_SHAPES_SENTINEL } from '@/lib/canvas-agent/contract/teacher-bridge';

/**
 * Canonical sanitization happens in two passes:
 * 1. Structural parsing via the shared Zod schemas (type guardrails, defaulting).
 * 2. Graph-aware guardrails (existence checks, ID filtering, range clamps).
 * A narrow semantic rewrite is allowed for explicit target-id contracts:
 * update_shape on a missing explicit id may be promoted to create_shape so
 * deterministic "ensure this id exists" flows do not dead-loop.
 */

export type CanvasShapeExistence = (id: string) => boolean;

export type SanitizeActionOptions = {
  promoteMissingUpdateShapeIds?: Iterable<string>;
  knownShapeIds?: Iterable<string>;
};

const normalizeShapeId = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('shape:') ? trimmed.slice('shape:'.length) : trimmed;
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const hasRenderableUpdatePayload = (params: Record<string, unknown>): boolean => {
  if (finiteNumber(params.x) !== undefined || finiteNumber(params.y) !== undefined) return true;
  const props = params.props;
  if (!props || typeof props !== 'object') return false;
  const record = props as Record<string, unknown>;
  if (
    finiteNumber(record.x) !== undefined ||
    finiteNumber(record.y) !== undefined ||
    finiteNumber(record.w) !== undefined ||
    finiteNumber(record.h) !== undefined
  ) {
    return true;
  }
  if (typeof record.text === 'string' && record.text.trim().length > 0) return true;
  if (typeof record.label === 'string' && record.label.trim().length > 0) return true;
  if (typeof record.content === 'string' && record.content.trim().length > 0) return true;
  if (record.richText && typeof record.richText === 'object') return true;
  if (record.points !== undefined || record.startPoint !== undefined || record.endPoint !== undefined) return true;
  return Object.keys(record).length > 0;
};

const inferCreateShapeTypeFromUpdate = (params: Record<string, unknown>): string => {
  const explicitType = resolveShapeType(typeof params.type === 'string' ? params.type : undefined);
  if (explicitType) return explicitType;
  const props = params.props && typeof params.props === 'object' ? (params.props as Record<string, unknown>) : {};
  if (
    props.points !== undefined ||
    props.startPoint !== undefined ||
    props.endPoint !== undefined ||
    props.start !== undefined ||
    props.end !== undefined
  ) {
    return 'line';
  }
  if (
    typeof props.text === 'string' ||
    typeof props.label === 'string' ||
    typeof props.content === 'string' ||
    (props.richText && typeof props.richText === 'object')
  ) {
    return 'note';
  }
  return 'rectangle';
};

const buildCreateFromMissingUpdate = (action: AgentAction, params: Record<string, unknown>): AgentAction | null => {
  const targetId = normalizeShapeId(params.id);
  if (!targetId) return null;
  if (!hasRenderableUpdatePayload(params)) return null;

  const rawProps = params.props && typeof params.props === 'object'
    ? { ...(params.props as Record<string, unknown>) }
    : {};
  const x = finiteNumber(params.x) ?? finiteNumber(rawProps.x) ?? 0;
  const y = finiteNumber(params.y) ?? finiteNumber(rawProps.y) ?? 0;
  delete rawProps.x;
  delete rawProps.y;

  const shapeType = inferCreateShapeTypeFromUpdate(params);
  const sanitizedProps = sanitizeShapeProps(rawProps, shapeType);
  const nextParams: Record<string, unknown> = {
    id: targetId,
    type: shapeType,
    x,
    y,
  };
  if (Object.keys(sanitizedProps).length > 0) {
    nextParams.props = sanitizedProps;
  }

  return {
    id: action.id,
    name: 'create_shape',
    params: nextParams,
  };
};

export function sanitizeActions(
  actions: AgentAction[],
  exists: CanvasShapeExistence,
  options?: SanitizeActionOptions,
): AgentAction[] {
  const parsed: Array<{ action: AgentAction; params: any }> = [];
  const createdIds = new Set<string>();
  const knownShapeIds = new Set<string>(
    Array.from(options?.knownShapeIds ?? [])
      .map((id) => normalizeShapeId(id))
      .filter((id) => id.length > 0),
  );
  const promoteMissingUpdateShapeIds = new Set<string>(
    Array.from(options?.promoteMissingUpdateShapeIds ?? [])
      .map((id) => normalizeShapeId(id))
      .filter((id) => id.length > 0),
  );

  for (const action of actions) {
    try {
      const schema = actionParamSchemas[action.name];
      if (!schema) continue;

      const params: any = schema.parse(action.params ?? {});

      if (action.name === 'create_shape') {
        if (!params.id) params.id = newAgentShapeId();
        if (typeof params.id === 'string' && params.id) {
          const normalized = normalizeShapeId(params.id);
          if (normalized) {
            createdIds.add(normalized);
            knownShapeIds.add(normalized);
          }
        }
      } else if (action.name === 'group') {
        if (typeof params.groupId === 'string' && params.groupId) {
          const normalized = normalizeShapeId(params.groupId);
          if (normalized) {
            createdIds.add(normalized);
            knownShapeIds.add(normalized);
          }
        }
      }

      parsed.push({ action, params });
    } catch {
      // drop invalid action
    }
  }

  const isKnown = (id: string) => {
    const normalized = normalizeShapeId(id);
    if (!normalized) return false;
    return (
      createdIds.has(normalized) ||
      knownShapeIds.has(normalized) ||
      exists(normalized) ||
      exists(`shape:${normalized}`)
    );
  };
  const sanitized: AgentAction[] = [];

  for (const parsedItem of parsed) {
    try {
      let action = parsedItem.action;
      let params = parsedItem.params;

      switch (action.name) {
        case 'update_shape': {
          if (!isKnown(params.id)) {
            const targetId = normalizeShapeId(params.id);
            if (!targetId || !promoteMissingUpdateShapeIds.has(targetId)) continue;
            const promoted = buildCreateFromMissingUpdate(action, params as Record<string, unknown>);
            if (!promoted) continue;
            action = promoted;
            params = promoted.params;
            createdIds.add(targetId);
          }
          break;
        }
        case 'delete_shape': {
          const requestedIds = Array.isArray(params.ids)
            ? (params.ids as unknown[])
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                .map((id) => id.trim())
            : [];
          const requestedNormalized = requestedIds.map((id) => normalizeShapeId(id));
          const deleteAllRequested = requestedNormalized.some(
            (id) => id === CLEAR_ALL_SHAPES_SENTINEL || id === 'all' || id === '*',
          );
          if (deleteAllRequested) {
            const ids = Array.from(knownShapeIds);
            if (ids.length === 0) continue;
            params.ids = ids;
            break;
          }
          const filteredIds = requestedIds
            .map((id) => normalizeShapeId(id))
            .filter((id) => isKnown(id));
          if (filteredIds.length === 0) continue;
          params.ids = filteredIds;
          break;
        }
        case 'move':
        case 'rotate':
        case 'reorder': {
          const filteredIds = (params.ids as string[])
            .map((id) => normalizeShapeId(id))
            .filter((id) => isKnown(id));
          if (filteredIds.length === 0) continue;
          params.ids = filteredIds;
          break;
        }
        case 'group': {
          const filtered = (params.ids as string[]).map((id) => normalizeShapeId(id)).filter((id) => isKnown(id));
          if (filtered.length < 2) continue;
          params.ids = filtered;
          break;
        }
        case 'stack':
        case 'align':
        case 'distribute': {
          const filtered = (params.ids as string[]).map((id) => normalizeShapeId(id)).filter((id) => isKnown(id));
          if (filtered.length < 2) continue;
          params.ids = filtered;
          break;
        }
        case 'ungroup':
          params.id = normalizeShapeId(params.id);
          if (!isKnown(params.id)) continue;
          break;
        default:
          break;
      }

      // Clamp numeric values to sane ranges
      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
      if (action.name === 'resize') {
        params.w = clamp(params.w, 1, 100000);
        params.h = clamp(params.h, 1, 100000);
      }
      if (action.name === 'move') {
        params.dx = clamp(params.dx, -100000, 100000);
        params.dy = clamp(params.dy, -100000, 100000);
      }
      if (action.name === 'rotate') {
        params.angle = clamp(params.angle, -Math.PI * 4, Math.PI * 4);
      }

      sanitized.push({ ...action, params });
    } catch {
      // drop invalid action
    }
  }

  sanitized.sort((a, b) => {
    const order = (x: AgentAction) => (x.name === 'create_shape' ? 0 : x.name === 'update_shape' ? 1 : x.name === 'delete_shape' ? 2 : 1);
    return order(a) - order(b);
  });

  return sanitized;
}
