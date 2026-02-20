import type { AgentAction } from '@/lib/canvas-agent/contract/types';
import { actionParamSchemas } from '@/lib/canvas-agent/contract/parsers';
import { newAgentShapeId } from '@/lib/canvas-agent/contract/ids';
import { CLEAR_ALL_SHAPES_SENTINEL } from '@/lib/canvas-agent/contract/teacher-bridge';

/**
 * Canonical sanitization happens in two passes:
 * 1. Structural parsing via the shared Zod schemas (type guardrails, defaulting).
 * 2. Graph-aware guardrails (existence checks, ID filtering, range clamps).
 */

export type CanvasShapeExistence = (id: string) => boolean;

export type SanitizeActionOptions = {
  knownShapeIds?: Iterable<string>;
  onMissingUpdateTargetDropped?: (shapeId: string) => void;
};

const normalizeShapeId = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('shape:') ? trimmed.slice('shape:'.length) : trimmed;
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
            if (targetId) {
              options?.onMissingUpdateTargetDropped?.(targetId);
            }
            continue;
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
