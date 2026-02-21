import { TEACHER_ACTIONS, type TeacherActionName } from './teacher';
import { validateTeacherActionPayload } from './teacher-validation';
import type { ActionName } from './types';

type CanonicalAction = {
  id?: string | number;
  name: ActionName;
  params: Record<string, unknown>;
};

const teacherActionSet = new Set<TeacherActionName>(TEACHER_ACTIONS);

const toNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const asString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

const asStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(asString).filter((entry): entry is string => Boolean(entry));
  return result.length > 0 ? result : undefined;
};

const asBoolean = (value: unknown, fallback = false) => (typeof value === 'boolean' ? value : fallback);

const normalizeTodoStatus = (value: unknown): 'todo' | 'in-progress' | 'done' => {
  const normalized = asString(value)?.toLowerCase();
  if (normalized === 'in-progress' || normalized === 'done') return normalized;
  return 'todo';
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const omitKeys = new Set(['_type', 'shapeId', 'x', 'y']);

const toCanonicalShapeParams = (shapePayload: Record<string, unknown>) => {
  const type = asString(shapePayload._type) ?? 'unknown';
  const id = asString(shapePayload.shapeId);
  const x = toNumber(shapePayload.x);
  const y = toNumber(shapePayload.y);
  const props: Record<string, unknown> = {};
  Object.entries(shapePayload).forEach(([key, value]) => {
    if (omitKeys.has(key)) return;
    props[key] = value;
  });
  return { type, id, x, y, props };
};

const mapAlignment = (alignment: string) => {
  switch (alignment) {
    case 'left':
      return { axis: 'x', mode: 'start' } as const;
    case 'right':
      return { axis: 'x', mode: 'end' } as const;
    case 'center-horizontal':
      return { axis: 'x', mode: 'center' } as const;
    case 'top':
      return { axis: 'y', mode: 'start' } as const;
    case 'bottom':
      return { axis: 'y', mode: 'end' } as const;
    default:
      return { axis: 'y', mode: 'center' } as const;
  }
};

const normalizePenPoints = (points: unknown) => {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const x = toNumber((point as { x?: unknown })?.x);
      const y = toNumber((point as { y?: unknown })?.y);
      if (x === undefined || y === undefined) return null;
      return { x, y };
    })
    .filter((point): point is { x: number; y: number } => Boolean(point));
};

const buildDrawSegments = (points: { x: number; y: number }[], isClosed: boolean) => {
  if (points.length < 2) return null;
  const closedPoints = isClosed ? [...points, points[0]] : points;
  const minX = Math.min(...closedPoints.map((p) => p.x));
  const minY = Math.min(...closedPoints.map((p) => p.y));
  const relativePoints = closedPoints.map((point) => ({
    x: point.x - minX,
    y: point.y - minY,
    z: 0.75,
  }));
  if (relativePoints.length < 2) return null;
  return {
    origin: { x: minX, y: minY },
    segments: [{ type: 'free', points: relativePoints }],
  };
};

export const CLEAR_ALL_SHAPES_SENTINEL = '__all__';

const teacherConverters: Partial<Record<TeacherActionName, (payload: Record<string, unknown>) => CanonicalAction | null>> =
  {
    clear: () => ({ name: 'delete_shape', params: { ids: [CLEAR_ALL_SHAPES_SENTINEL] } }),
    message: (payload) => {
      const text = typeof payload.text === 'string' ? payload.text : '';
      return { name: 'message', params: { text } };
    },
    think: (payload) => {
      const text = typeof payload.text === 'string' ? payload.text : '';
      return { name: 'think', params: { text } };
    },
    'add-detail': (payload) => {
      const hint = typeof payload.intent === 'string' ? payload.intent : undefined;
      return { name: 'add_detail', params: hint ? { hint } : {} };
    },
    'update-todo-list': (payload) => {
      const text = typeof payload.text === 'string' ? payload.text : '';
      return { name: 'todo', params: { text } };
    },
    'upsert-personal-todo-item': (payload) => {
      const id = asString(payload.id);
      if (!id) return null;
      const params: Record<string, unknown> = {
        id,
        status: normalizeTodoStatus(payload.status),
      };
      const text = asString(payload.text);
      if (text) params.text = text;
      return { name: 'upsert-personal-todo-item', params };
    },
    'delete-personal-todo-items': (payload) => {
      const ids = asStringArray(payload.ids);
      if (!ids) return null;
      return { name: 'delete-personal-todo-items', params: { ids } };
    },
    'claim-todo-item': (payload) => {
      const todoItemId = asString(payload.todoItemId);
      if (!todoItemId) return null;
      return { name: 'claim-todo-item', params: { todoItemId } };
    },
    setMyView: (payload) => {
      const x = toNumber(payload.x) ?? 0;
      const y = toNumber(payload.y) ?? 0;
      const w = toNumber(payload.w) ?? 0;
      const h = toNumber(payload.h) ?? 0;
      return { name: 'set_viewport', params: { bounds: { x, y, w, h }, smooth: false } };
    },
    'fly-to-bounds': (payload) => {
      const x = toNumber(payload.x) ?? 0;
      const y = toNumber(payload.y) ?? 0;
      const w = toNumber(payload.w) ?? 0;
      const h = toNumber(payload.h) ?? 0;
      return { name: 'set_viewport', params: { bounds: { x, y, w, h }, smooth: false } };
    },
    create: (payload) => {
      const shape = payload.shape;
      if (!shape || typeof shape !== 'object') return null;
      const { type, id, x, y, props } = toCanonicalShapeParams(shape as Record<string, unknown>);
      const params: Record<string, unknown> = { type, props };
      if (id) params.id = id;
      if (x !== undefined) params.x = x;
      if (y !== undefined) params.y = y;
      return { name: 'create_shape', params };
    },
    update: (payload) => {
      const update = payload.update;
      if (!update || typeof update !== 'object') return null;
      const { id, props, x, y } = toCanonicalShapeParams(update as Record<string, unknown>);
      if (!id) return null;
      const params: Record<string, unknown> = { id, props };
      if (x !== undefined) params.x = x;
      if (y !== undefined) params.y = y;
      return { name: 'update_shape', params };
    },
    label: (payload) => {
      const shapeId = asString(payload.shapeId);
      const text = asString(payload.text);
      if (!shapeId || !text) return null;
      return { name: 'update_shape', params: { id: shapeId, props: { text } } };
    },
    delete: (payload) => {
      const targetId = asString(payload.shapeId);
      if (!targetId) return null;
      return { name: 'delete_shape', params: { ids: [targetId] } };
    },
    move: (payload) => {
      const shapeId = asString(payload.shapeId);
      const x = toNumber(payload.x);
      const y = toNumber(payload.y);
      if (!shapeId || x === undefined || y === undefined) return null;
      return { name: 'move', params: { ids: [shapeId], target: { x, y } } };
    },
    'move-position': (payload) => {
      const x = toNumber(payload.x) ?? 0;
      const y = toNumber(payload.y) ?? 0;
      return { name: 'set_viewport', params: { bounds: { x: x - 160, y: y - 120, w: 320, h: 240 }, smooth: true } };
    },
    offset: (payload) => {
      const shapeIds = asStringArray(payload.shapeIds);
      const dx = toNumber(payload.offsetX);
      const dy = toNumber(payload.offsetY);
      if (!shapeIds || dx === undefined || dy === undefined) return null;
      return { name: 'move', params: { ids: shapeIds, dx, dy } };
    },
    align: (payload) => {
      const ids = asStringArray(payload.shapeIds);
      const alignment = asString(payload.alignment);
      if (!ids || !alignment) return null;
      const { axis, mode } = mapAlignment(alignment);
      return { name: 'align', params: { ids, axis, mode } };
    },
    distribute: (payload) => {
      const ids = asStringArray(payload.shapeIds);
      const direction = asString(payload.direction);
      if (!ids || !direction) return null;
      const axis = direction === 'horizontal' ? 'x' : 'y';
      return { name: 'distribute', params: { ids, axis } };
    },
    stack: (payload) => {
      const ids = asStringArray(payload.shapeIds);
      const direction = asString(payload.direction);
      const gap = toNumber(payload.gap) ?? 0;
      if (!ids || !direction) return null;
      const mappedDirection = direction === 'horizontal' ? 'row' : 'column';
      return { name: 'stack', params: { ids, direction: mappedDirection, gap } };
    },
    resize: (payload) => {
      const shapeIds = asStringArray(payload.shapeIds);
      const scaleX = toNumber(payload.scaleX);
      const scaleY = toNumber(payload.scaleY);
      const originX = toNumber(payload.originX);
      const originY = toNumber(payload.originY);
      if (!shapeIds || scaleX === undefined || scaleY === undefined || originX === undefined || originY === undefined) {
        return null;
      }
      return {
        name: 'resize',
        params: {
          shapeIds,
          scaleX,
          scaleY,
          originX,
          originY,
        },
      };
    },
    rotate: (payload) => {
      const shapeIds = asStringArray(payload.shapeIds);
      const degrees = toNumber(payload.degrees);
      if (!shapeIds || degrees === undefined) return null;
      const params: Record<string, unknown> = { shapeIds, degrees };
      const originX = toNumber(payload.originX);
      const originY = toNumber(payload.originY);
      const centerY = toNumber(payload.centerY);
      if (originX !== undefined) params.originX = originX;
      if (originY !== undefined) params.originY = originY;
      if (centerY !== undefined) params.centerY = centerY;
      return { name: 'rotate', params };
    },
    bringToFront: (payload) => {
      const ids = asStringArray(payload.shapeIds);
      if (!ids) return null;
      return { name: 'reorder', params: { ids, where: 'front' } };
    },
    'bring-to-front': (payload) => {
      const ids = asStringArray(payload.shapeIds);
      if (!ids) return null;
      return { name: 'reorder', params: { ids, where: 'front' } };
    },
    sendToBack: (payload) => {
      const ids = asStringArray(payload.shapeIds);
      if (!ids) return null;
      return { name: 'reorder', params: { ids, where: 'back' } };
    },
    'send-to-back': (payload) => {
      const ids = asStringArray(payload.shapeIds);
      if (!ids) return null;
      return { name: 'reorder', params: { ids, where: 'back' } };
    },
    pen: (payload) => {
      const points = normalizePenPoints(payload.points);
      if (points.length < 2) return null;
      const closed = Boolean(payload.closed);
      const normalized = buildDrawSegments(points, closed);
      if (!normalized) return null;
      const color = asString(payload.color) ?? 'black';
      const fill = asString(payload.fill) ?? 'none';
      const params: Record<string, unknown> = {
        type: 'draw',
        id: asString(payload.shapeId),
        x: normalized.origin.x,
        y: normalized.origin.y,
        props: {
          color,
          fill,
          dash: payload.style === 'straight' ? 'solid' : 'draw',
          size: 's',
          isPen: true,
          isClosed: closed,
          segments: normalized.segments,
        },
      };
      return { name: 'create_shape', params };
    },
    place: (payload) => {
      const shapeId = asString(payload.shapeId);
      const referenceShapeId = asString(payload.referenceShapeId);
      const side = asString(payload.side);
      const align = asString(payload.align);
      if (!shapeId || !referenceShapeId || !side || !align) return null;
      return {
        name: 'place',
        params: {
          shapeId,
          referenceShapeId,
          side,
          align,
          sideOffset: toNumber(payload.sideOffset) ?? 0,
          alignOffset: toNumber(payload.alignOffset) ?? 0,
        },
      };
    },
    review: (payload) => {
      const hint = asString(payload.intent) ?? 'Review current output and continue if needed.';
      return { name: 'review', params: { hint } };
    },
    count: (payload) => ({
      name: 'add_detail',
      params: { hint: asString(payload.expression) ?? 'Count shapes and continue.' },
    }),
    countryInfo: (payload) => {
      const code = asString(payload.code);
      if (!code) return null;
      return { name: 'country-info', params: { code } };
    },
    'country-info': (payload) => {
      const code = asString(payload.code);
      if (!code) return null;
      return { name: 'country-info', params: { code } };
    },
    getInspiration: () => ({
      name: 'add_detail',
      params: { hint: 'Gather inspiration and continue canvas edits.' },
    }),
    'start-project': (payload) => ({
      name: 'start-project',
      params: {
        projectName: asString(payload.projectName) ?? 'untitled-project',
        projectDescription: asString(payload.projectDescription) ?? '',
        projectColor: asString(payload.projectColor) ?? 'blue',
        projectPlan: asString(payload.projectPlan) ?? '',
      },
    }),
    'start-duo-project': (payload) => ({
      name: 'start-duo-project',
      params: {
        projectName: asString(payload.projectName) ?? 'untitled-project',
        projectDescription: asString(payload.projectDescription) ?? '',
        projectColor: asString(payload.projectColor) ?? 'blue',
        projectPlan: asString(payload.projectPlan) ?? '',
      },
    }),
    'end-project': () => ({ name: 'end-project', params: {} }),
    'end-duo-project': () => ({ name: 'end-duo-project', params: {} }),
    'abort-project': (payload) => ({
      name: 'abort-project',
      params: { reason: asString(payload.reason) ?? 'aborted_by_agent' },
    }),
    'abort-duo-project': (payload) => ({
      name: 'abort-duo-project',
      params: { reason: asString(payload.reason) ?? 'aborted_by_agent' },
    }),
    'enter-orchestration-mode': () => ({ name: 'enter-orchestration-mode', params: {} }),
    'start-task': (payload) => {
      const taskId = asString(payload.taskId);
      if (!taskId) return null;
      return { name: 'start-task', params: { taskId } };
    },
    'start-duo-task': (payload) => {
      const taskId = asString(payload.taskId);
      if (!taskId) return null;
      return { name: 'start-duo-task', params: { taskId } };
    },
    'mark-task-done': (payload) => ({
      name: 'mark-task-done',
      params: {
        taskId: asString(payload.taskId) ?? null,
      },
    }),
    'mark-my-task-done': (payload) => ({
      name: 'mark-my-task-done',
      params: {
        taskId: asString(payload.taskId) ?? null,
      },
    }),
    'mark-duo-task-done': (payload) => ({
      name: 'mark-duo-task-done',
      params: {
        taskId: asString(payload.taskId) ?? null,
      },
    }),
    'await-tasks-completion': (payload) => {
      const taskIds = asStringArray(payload.taskIds);
      if (!taskIds) return null;
      return { name: 'await-tasks-completion', params: { taskIds } };
    },
    'await-duo-tasks-completion': (payload) => {
      const taskIds = asStringArray(payload.taskIds);
      if (!taskIds) return null;
      return { name: 'await-duo-tasks-completion', params: { taskIds } };
    },
    'create-task': (payload) => {
      const taskId = asString(payload.taskId);
      if (!taskId) return null;
      return {
        name: 'create-task',
        params: {
          taskId,
          title: asString(payload.title) ?? taskId,
          text: asString(payload.text) ?? '',
          x: toNumber(payload.x) ?? 0,
          y: toNumber(payload.y) ?? 0,
          w: toNumber(payload.w) ?? 240,
          h: toNumber(payload.h) ?? 140,
        },
      };
    },
    'create-project-task': (payload) => {
      const taskId = asString(payload.taskId);
      if (!taskId) return null;
      return {
        name: 'create-project-task',
        params: {
          taskId,
          title: asString(payload.title) ?? taskId,
          text: asString(payload.text) ?? '',
          assignedTo: asString(payload.assignedTo) ?? null,
          x: toNumber(payload.x) ?? 0,
          y: toNumber(payload.y) ?? 0,
          w: toNumber(payload.w) ?? 240,
          h: toNumber(payload.h) ?? 140,
        },
      };
    },
    'create-duo-task': (payload) => {
      const taskId = asString(payload.taskId);
      if (!taskId) return null;
      return {
        name: 'create-duo-task',
        params: {
          taskId,
          title: asString(payload.title) ?? taskId,
          text: asString(payload.text) ?? '',
          assignedTo: asString(payload.assignedTo) ?? null,
          x: toNumber(payload.x) ?? 0,
          y: toNumber(payload.y) ?? 0,
          w: toNumber(payload.w) ?? 240,
          h: toNumber(payload.h) ?? 140,
        },
      };
    },
    'delete-project-task': (payload) => {
      const taskId = asString(payload.taskId);
      if (!taskId) return null;
      return {
        name: 'delete-project-task',
        params: {
          taskId,
          reason: asString(payload.reason) ?? 'deleted_by_agent',
        },
      };
    },
    'direct-to-start-project-task': (payload) => {
      const taskId = asString(payload.taskId);
      const otherFairyId = asString(payload.otherFairyId);
      if (!taskId || !otherFairyId) return null;
      return { name: 'direct-to-start-project-task', params: { taskId, otherFairyId } };
    },
    'direct-to-start-duo-task': (payload) => {
      const taskId = asString(payload.taskId);
      const otherFairyId = asString(payload.otherFairyId);
      if (!taskId || !otherFairyId) return null;
      return { name: 'direct-to-start-duo-task', params: { taskId, otherFairyId } };
    },
    'activate-agent': (payload) => {
      const fairyId = asString(payload.fairyId);
      if (!fairyId) return null;
      return { name: 'activate-agent', params: { fairyId } };
    },
    'change-page': (payload) => {
      const pageName = asString(payload.pageName);
      if (!pageName) return null;
      return { name: 'change-page', params: { pageName } };
    },
    'create-page': (payload) => {
      const pageName = asString(payload.pageName);
      if (!pageName) return null;
      return {
        name: 'create-page',
        params: {
          pageName,
          switchToPage: asBoolean(payload.switchToPage, true),
        },
      };
    },
  };

export const teacherConverterCoverage = {
  supported: TEACHER_ACTIONS.filter((actionName) => Boolean(teacherConverters[actionName])),
  missing: TEACHER_ACTIONS.filter((actionName) => !teacherConverters[actionName]),
};

function isTeacherActionCandidate(value: unknown): value is { _type: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { _type?: unknown })._type === 'string');
}

const STREAMING_METADATA_FIELDS = new Set(['complete', 'time']);

function stripStreamingMetadata<T extends Record<string, unknown>>(payload: T): T {
  const result: Record<string, unknown> = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (STREAMING_METADATA_FIELDS.has(key)) return;
    result[key] = value;
  });
  return result as T;
}

export function convertTeacherAction(raw: unknown): CanonicalAction | null {
  if (!isTeacherActionCandidate(raw)) return null;
  const actionType = raw._type as TeacherActionName;
  if (!teacherActionSet.has(actionType)) return null;

  const sanitized = stripStreamingMetadata(raw as Record<string, unknown>);
  const validation = validateTeacherActionPayload(actionType, sanitized);
  if (!validation.ok) {
    console.warn('[CanvasAgent:TeacherValidationFailed]', {
      action: actionType,
      issues: validation.issues,
    });
    return null;
  }

  const converter = teacherConverters[actionType];
  if (!converter) {
    console.warn('[CanvasAgent:TeacherActionUnsupported]', { action: actionType });
    return null;
  }

  const converted = converter(sanitized);
  if (converted) return converted;
  console.warn('[CanvasAgent:TeacherActionInvalidPayload]', { action: actionType });
  return null;
}
