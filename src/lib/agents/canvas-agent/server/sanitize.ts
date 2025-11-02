import type { AgentAction } from '../shared/types';
import { actionParamSchemas } from '../shared/parsers';
import { newAgentShapeId } from '../shared/ids';

export type CanvasShapeExistence = (id: string) => boolean;

export function sanitizeActions(actions: AgentAction[], exists: CanvasShapeExistence): AgentAction[] {
  const parsed: Array<{ action: AgentAction; params: any }> = [];
  const createdIds = new Set<string>();

  for (const action of actions) {
    try {
      const schema = actionParamSchemas[action.name];
      if (!schema) continue;

      const params: any = schema.parse(action.params ?? {});

      if (action.name === 'create_shape') {
        if (!params.id) params.id = newAgentShapeId();
        if (typeof params.id === 'string' && params.id) {
          createdIds.add(params.id);
        }
      } else if (action.name === 'draw_pen') {
        if (typeof params.id === 'string' && params.id) {
          createdIds.add(params.id);
        }
      } else if (action.name === 'group') {
        if (typeof params.groupId === 'string' && params.groupId) {
          createdIds.add(params.groupId);
        }
      }

      parsed.push({ action, params });
    } catch {
      // drop invalid action
    }
  }

  const isKnown = (id: string) => exists(id) || createdIds.has(id);
  const sanitized: AgentAction[] = [];

  for (const { action, params } of parsed) {
    try {
      switch (action.name) {
        case 'update_shape':
          if (!isKnown(params.id)) continue;
          break;
        case 'delete_shape':
        case 'move':
        case 'rotate': {
          const filteredIds = (params.ids as string[]).filter((id) => isKnown(id));
          if (filteredIds.length === 0) continue;
          params.ids = filteredIds;
          break;
        }
        case 'ungroup':
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



