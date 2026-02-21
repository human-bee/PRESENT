import { z } from 'zod';
import { ActionNameSchema, AgentActionEnvelopeSchema, type ActionName } from './types';
import { TEACHER_ACTIONS, type TeacherActionName } from './teacher';

// Define parameter schemas per action. Keep permissive initial version; tighten later.
const boundsSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const drawPointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite().optional(),
  })
  .passthrough();

const drawSegmentSchema = z
  .object({
    type: z.string().default('free'),
    points: z.array(drawPointSchema).min(2, { message: 'Draw segments need at least two points.' }),
  })
  .passthrough();

const normalizeTextAlign = (value: unknown): 'start' | 'middle' | 'end' | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'start' || normalized === 'left') return 'start';
  if (normalized === 'middle' || normalized === 'center') return 'middle';
  if (normalized === 'end' || normalized === 'right') return 'end';
  return undefined;
};

const canonicalAlignSchema = z
  .object({
    ids: z.array(z.string()).min(2),
    axis: z.enum(['x', 'y']),
    mode: z.enum(['start', 'center', 'end']).default('start'),
  })
  .passthrough();

const tldrawAlignSchema = z.object({
  shapeIds: z.array(z.string()).min(2),
  alignment: z.enum(['top', 'bottom', 'left', 'right', 'center-horizontal', 'center-vertical']),
  gap: z.number().optional(),
}).passthrough();

const canonicalRotateSchema = z.object({ ids: z.array(z.string()).min(1), angle: z.number() }).passthrough();

const tldrawRotateSchema = z.object({
  shapeIds: z.array(z.string()).min(1),
  degrees: z.number(),
  originX: z.number().optional(),
  originY: z.number().optional(),
  centerY: z.number().optional(),
}).passthrough();

const mapAlignmentToAxisMode = (alignment: z.infer<typeof tldrawAlignSchema>['alignment']) => {
  switch (alignment) {
    case 'left':
      return { axis: 'x' as const, mode: 'start' as const };
    case 'right':
      return { axis: 'x' as const, mode: 'end' as const };
    case 'center-horizontal':
      return { axis: 'x' as const, mode: 'center' as const };
    case 'top':
      return { axis: 'y' as const, mode: 'start' as const };
    case 'bottom':
      return { axis: 'y' as const, mode: 'end' as const };
    case 'center-vertical':
    default:
      return { axis: 'y' as const, mode: 'center' as const };
  }
};

const moveDeltaSchema = z.object({ ids: z.array(z.string()).min(1), dx: z.number(), dy: z.number() }).passthrough();

const moveAbsoluteSchema = z
  .object({
    ids: z.array(z.string()).min(1),
    target: z.object({ x: z.number(), y: z.number() }),
  })
  .passthrough();

const moveSingleAbsoluteSchema = z
  .object({ shapeId: z.string(), x: z.number(), y: z.number() })
  .transform((value) => ({ ids: [value.shapeId], target: { x: value.x, y: value.y } }));

const scaleResizeSchema = z
  .object({
    shapeIds: z.array(z.string()).min(1),
    originX: z.number(),
    originY: z.number(),
    scaleX: z.number().positive(),
    scaleY: z.number().positive(),
  })
  .passthrough();

const placeSchema = z
  .object({
    shapeId: z.string(),
    referenceShapeId: z.string(),
    side: z.enum(['top', 'bottom', 'left', 'right']),
    align: z.enum(['start', 'center', 'end']).default('center'),
    sideOffset: z.number().optional(),
    alignOffset: z.number().optional(),
  })
  .passthrough();

const taskIdSchema = z.string().min(1);
const agentIdSchema = z.string().min(1);

const projectStartSchema = z
  .object({
    projectName: z.string().min(1),
    projectDescription: z.string().optional(),
    projectColor: z.string().optional(),
    projectPlan: z.string().optional(),
  })
  .passthrough();

const taskCreateSchema = z
  .object({
    taskId: taskIdSchema,
    title: z.string().min(1),
    text: z.string().optional(),
    assignedTo: agentIdSchema.nullable().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    w: z.number().finite().optional(),
    h: z.number().finite().optional(),
  })
  .passthrough();

const taskStartSchema = z
  .object({
    taskId: taskIdSchema,
  })
  .passthrough();

const taskDoneSchema = z
  .object({
    taskId: taskIdSchema.nullable().optional(),
  })
  .passthrough();

const awaitTasksSchema = z
  .object({
    taskIds: z.array(taskIdSchema).min(1),
  })
  .passthrough();

const projectDeleteTaskSchema = z
  .object({
    taskId: taskIdSchema,
    reason: z.string().optional(),
  })
  .passthrough();

const directStartTaskSchema = z
  .object({
    taskId: taskIdSchema,
    otherFairyId: agentIdSchema,
  })
  .passthrough();

const activateAgentSchema = z
  .object({
    fairyId: agentIdSchema,
  })
  .passthrough();

const pageChangeSchema = z
  .object({
    pageName: z.string().min(1),
    intent: z.string().optional(),
  })
  .passthrough();

const pageCreateSchema = z
  .object({
    pageName: z.string().min(1),
    intent: z.string().optional(),
    switchToPage: z.boolean().optional(),
  })
  .passthrough();

const upsertPersonalTodoSchema = z
  .object({
    id: taskIdSchema,
    status: z.enum(['todo', 'in-progress', 'done']),
    text: z.string().optional(),
  })
  .passthrough();

const deletePersonalTodoItemsSchema = z
  .object({
    ids: z.array(taskIdSchema).min(1),
  })
  .passthrough();

const claimTodoItemSchema = z
  .object({
    todoItemId: taskIdSchema,
  })
  .passthrough();

const abortProjectSchema = z
  .object({
    reason: z.string().optional(),
  })
  .passthrough();

const legacyActionSchemas = {
  create_shape: z
    .object({
      type: z.string(),
      id: z.string().optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .transform((value) => {
      if (value.type?.toLowerCase() !== 'text') return value;
      if (!value.props || typeof value.props !== 'object') return value;
      const props = { ...(value.props as Record<string, unknown>) };
      if ('align' in props && !('textAlign' in props)) {
        const mapped = normalizeTextAlign(props.align);
        if (mapped) props.textAlign = mapped;
      }
      delete (props as any).align;
      return { ...value, props };
    })
    .superRefine((value, ctx) => {
      if (value.type?.toLowerCase() !== 'draw') return;
      const segments = (value.props as any)?.segments;
      if (!Array.isArray(segments) || segments.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Draw shapes must include props.segments with at least one segment.',
          path: ['props', 'segments'],
        });
        return;
      }

      segments.forEach((segment, segmentIndex) => {
        const parsed = drawSegmentSchema.safeParse(segment);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: parsed.error.issues[0]?.message ?? 'Invalid draw segment; provide ≥2 points.',
            path: ['props', 'segments', segmentIndex],
          });
        }
      });
    }),
  update_shape: z
    .object({
      id: z.string(),
      props: z.record(z.string(), z.unknown()).default({}),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
    })
    .passthrough(),
  delete_shape: z.object({ ids: z.array(z.string()).min(1) }).passthrough(),
  move: z.union([moveDeltaSchema, moveAbsoluteSchema, moveSingleAbsoluteSchema]),
  resize: z
    .union([
      z
        .object({
          id: z.string(),
          w: z.number().positive(),
          h: z.number().positive(),
          anchor: z.string().optional(),
      })
      .passthrough(),
      scaleResizeSchema,
    ]),
  rotate: z.union([canonicalRotateSchema, tldrawRotateSchema]).transform((value) => {
    if (
      'shapeIds' in value &&
      Array.isArray((value as any).shapeIds) &&
      typeof (value as any).degrees === 'number'
    ) {
      return {
        ids: (value as any).shapeIds as string[],
        angle: (((value as any).degrees as number) * Math.PI) / 180,
      };
    }
    return value;
  }),
  group: z.object({ ids: z.array(z.string()).min(2), groupId: z.string().optional() }).passthrough(),
  ungroup: z.object({ id: z.string() }).passthrough(),
  align: z
    .union([canonicalAlignSchema, tldrawAlignSchema])
    .transform((value) => {
      if (
        'shapeIds' in value &&
        Array.isArray((value as any).shapeIds) &&
        typeof (value as any).alignment === 'string'
      ) {
        const { axis, mode } = mapAlignmentToAxisMode((value as any).alignment);
        return { ids: (value as any).shapeIds as string[], axis, mode };
      }
      return value;
    }),
  distribute: z
    .object({
      ids: z.array(z.string()).min(3),
      axis: z.enum(['x', 'y']),
    })
    .passthrough(),
  stack: z
    .object({
      ids: z.array(z.string()).min(2),
      direction: z.enum(['row', 'column']),
      gap: z.number().nonnegative().optional(),
    })
    .passthrough(),
  reorder: z
    .object({
      ids: z.array(z.string()).min(1),
      where: z.enum(['front', 'back', 'forward', 'backward']).optional(),
      position: z.enum(['front', 'back', 'forward', 'backward']).optional(),
    })
    .passthrough()
    .refine((value) => Boolean((value as any).where || (value as any).position), {
      message: 'Provide where or position when reordering shapes.',
      path: ['where'],
    }),
  think: z.object({ text: z.string() }).passthrough(),
  todo: z.object({ text: z.string() }).passthrough(),
  add_detail: z
    .object({
      targetIds: z.array(z.string()).optional(),
      hint: z.string().optional(),
      depth: z.number().int().nonnegative().optional(),
    })
    .passthrough(),
  set_viewport: z.object({ bounds: boundsSchema, smooth: z.boolean().optional() }).passthrough(),
  apply_preset: z
    .object({
      preset: z.string(),
      targetIds: z.array(z.string()).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      text: z.string().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
  message: z.object({ text: z.string() }).passthrough(),
  place: placeSchema,
  'start-project': projectStartSchema,
  'start-duo-project': projectStartSchema,
  'end-project': z.object({}).passthrough(),
  'end-duo-project': z.object({}).passthrough(),
  'abort-project': abortProjectSchema,
  'abort-duo-project': abortProjectSchema,
  'enter-orchestration-mode': z.object({}).passthrough(),
  'create-task': taskCreateSchema,
  'create-project-task': taskCreateSchema,
  'create-duo-task': taskCreateSchema,
  'delete-project-task': projectDeleteTaskSchema,
  'start-task': taskStartSchema,
  'start-duo-task': taskStartSchema,
  'mark-task-done': taskDoneSchema,
  'mark-my-task-done': taskDoneSchema,
  'mark-duo-task-done': taskDoneSchema,
  'await-tasks-completion': awaitTasksSchema,
  'await-duo-tasks-completion': awaitTasksSchema,
  'direct-to-start-project-task': directStartTaskSchema,
  'direct-to-start-duo-task': directStartTaskSchema,
  'activate-agent': activateAgentSchema,
  'change-page': pageChangeSchema,
  'create-page': pageCreateSchema,
  'upsert-personal-todo-item': upsertPersonalTodoSchema,
  'delete-personal-todo-items': deletePersonalTodoItemsSchema,
  'claim-todo-item': claimTodoItemSchema,
  'country-info': z.object({ code: z.string().min(1) }).passthrough(),
} satisfies Record<string, z.ZodTypeAny>;

type LegacyActionKey = keyof typeof legacyActionSchemas;

const fallbackTeacherActionSchema = z
  .object({
    _type: z.string().optional(),
  })
  .passthrough();

const teacherNameAliases: Partial<Record<TeacherActionName, LegacyActionKey>> = {
  'add-detail': 'add_detail',
  align: 'align',
  'bring-to-front': 'reorder',
  bringToFront: 'reorder',
  count: 'add_detail',
  countryInfo: 'country-info',
  create: 'create_shape',
  delete: 'delete_shape',
  distribute: 'distribute',
  'fly-to-bounds': 'set_viewport',
  getInspiration: 'add_detail',
  label: 'update_shape',
  message: 'message',
  move: 'move',
  'move-position': 'move',
  offset: 'move',
  pen: 'create_shape',
  place: 'place',
  review: 'add_detail',
  resize: 'resize',
  rotate: 'rotate',
  'send-to-back': 'reorder',
  stack: 'stack',
  sendToBack: 'reorder',
  think: 'think',
  update: 'update_shape',
  'update-todo-list': 'todo',
  setMyView: 'set_viewport',
};

const actionParamSchemasMap: Record<string, z.ZodTypeAny> = { ...legacyActionSchemas };

TEACHER_ACTIONS.forEach((teacherName) => {
  if (actionParamSchemasMap[teacherName]) {
    return;
  }
  const alias = teacherNameAliases[teacherName];
  if (alias && legacyActionSchemas[alias]) {
    actionParamSchemasMap[teacherName] = legacyActionSchemas[alias];
  } else {
    actionParamSchemasMap[teacherName] = fallbackTeacherActionSchema;
  }
});

export const actionParamSchemas = actionParamSchemasMap as Record<ActionName, z.ZodTypeAny>;

export function parseAction(action: { id: string; name: string; params: unknown }) {
  const name = ActionNameSchema.parse(action.name);
  const schema = actionParamSchemas[name];
  const params = schema.parse(action.params ?? {});
  return { id: String(action.id), name, params } as const;
}

export function parseEnvelope(input: unknown) {
  return AgentActionEnvelopeSchema.parse(input);
}
