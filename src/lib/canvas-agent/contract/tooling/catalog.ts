import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { actionParamSchemas } from '@/lib/canvas-agent/contract/parsers';
import { LEGACY_ACTION_NAMES } from '@/lib/canvas-agent/contract/types';
import { TEACHER_ACTIONS } from '@/lib/canvas-agent/contract/teacher';

const ACTION_NAMES = Array.from(new Set<string>([...LEGACY_ACTION_NAMES, ...TEACHER_ACTIONS]));
if (ACTION_NAMES.length === 0) {
  throw new Error('Canvas agent action registry is empty. Did you run scripts/gen-agent-contract.ts?');
}
const ACTION_NAME_TUPLE = ACTION_NAMES as [string, ...string[]];

const isZodSchemaLike = (value: unknown): value is z.ZodTypeAny => {
  if (!value || typeof value !== 'object') return false;
  try {
    const candidate = value as Record<string, unknown>;
    return typeof candidate.safeParse === 'function';
  } catch {
    return false;
  }
};

const readActionParamSchema = (actionName: string): z.ZodTypeAny | null => {
  try {
    const schema = actionParamSchemas[actionName];
    return isZodSchemaLike(schema) ? schema : null;
  } catch {
    return null;
  }
};

const actionSchemas = ACTION_NAME_TUPLE.map((actionName) => {
  const paramsSchema = readActionParamSchema(actionName);
  return z.object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.literal(actionName),
    params: paramsSchema ?? z.record(z.string(), z.unknown()),
  });
}) as unknown as [z.ZodTypeAny, ...z.ZodTypeAny[]];

const ActionUnionSchema = z.union(actionSchemas);

const ActionListSchema = z.object({ actions: z.array(ActionUnionSchema).min(1) });

export type ActionValidationError = { path: string; message: string };

export function validateCanonicalAction(action: unknown) {
  const result = ActionUnionSchema.safeParse(action);
  if (result.success) {
    return { ok: true as const, value: result.data };
  }
  return {
    ok: false as const,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.') || 'root',
      message: issue.message,
    })),
  };
}

const ACTION_SCHEMA_JSON = (() => {
  try {
    return zodToJsonSchema(ActionListSchema as any, {
      name: 'CanvasAgentActions',
      $refStrategy: 'root',
    });
  } catch (error) {
    console.warn('[CanvasAgentContract] failed to build JSON schema; using fallback schema', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              params: { type: 'object', additionalProperties: true },
            },
            required: ['name'],
          },
        },
      },
      required: ['actions'],
      additionalProperties: false,
    };
  }
})();

export function getActionSchemaJson() {
  return ACTION_SCHEMA_JSON;
}

export type ToolParamSpec = {
  name: string;
  type: string;
  required?: boolean;
  notes?: string;
};

export type ToolSpec = {
  name: string;
  description: string;
  params: ToolParamSpec[];
  example?: Record<string, unknown>;
};

const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'create_shape',
    description:
      'Create TLDraw geometry (note, text, rectangle, ellipse, arrow, draw, etc.). Supply canonical TLDraw props (segments for draw shapes); missing ids are auto-generated.',
    params: [
      { name: 'id', type: 'string', notes: 'Stable identifier; steward will generate if omitted.' },
      { name: 'type', type: "'note'|'text'|'rectangle'|…", required: true },
      { name: 'x', type: 'number', notes: 'Canvas X coordinate (top-left).' },
      { name: 'y', type: 'number', notes: 'Canvas Y coordinate (top-left).' },
      { name: 'props', type: 'ShapeProps', notes: 'TLDraw props such as w, h, text, font, size, color, fill, dash.' },
    ],
    example: {
      name: 'create_shape',
      params: {
        id: 'hero-note',
        type: 'note',
        x: -200,
        y: -120,
        props: { w: 280, h: 160, text: 'BRUTAL', font: 'mono', size: 'xl', color: 'red', fill: 'none' },
      },
    },
  },
  {
    name: 'update_shape',
    description: 'Restyle or resize an existing shape without recreating it.',
    params: [
      { name: 'id', type: 'string', required: true },
      { name: 'props', type: 'Partial<ShapeProps>', required: true, notes: 'Only include fields you want to change.' },
    ],
  },
  {
    name: 'delete_shape',
    description: 'Remove one or more shapes (prefer reuse over delete/recreate).',
    params: [{ name: 'ids', type: 'string[]', required: true }],
  },
  {
    name: 'move',
    description: 'Translate existing shapes by delta offsets.',
    params: [
      { name: 'ids', type: 'string[]', required: true },
      { name: 'dx', type: 'number', required: true },
      { name: 'dy', type: 'number', required: true },
    ],
  },
  {
    name: 'resize',
    description: 'Resize a shape around its anchor point.',
    params: [
      { name: 'id', type: 'string', required: true },
      { name: 'w', type: 'number', required: true },
      { name: 'h', type: 'number', required: true },
      { name: 'anchor', type: "'top-left'|'center'|…", notes: 'Optional anchor reference.' },
    ],
  },
  {
    name: 'rotate',
    description: 'Rotate shapes by radians.',
    params: [
      { name: 'ids', type: 'string[]', required: true },
      { name: 'angle', type: 'number', required: true, notes: 'Radians; positive rotates clockwise.' },
    ],
  },
  {
    name: 'group',
    description: 'Group multiple shapes for collective transforms.',
    params: [{ name: 'ids', type: 'string[]', required: true }],
  },
  {
    name: 'ungroup',
    description: 'Ungroup a previously grouped collection.',
    params: [{ name: 'id', type: 'string', required: true }],
  },
  {
    name: 'align',
    description: 'Align shapes along X or Y axes.',
    params: [
      { name: 'ids', type: 'string[]', required: true },
      { name: 'axis', type: "'x'|'y'", required: true },
      { name: 'mode', type: "'start'|'center'|'end'", notes: 'Default = start.' },
    ],
  },
  {
    name: 'distribute',
    description: 'Evenly distribute 3+ shapes along an axis.',
    params: [
      { name: 'ids', type: 'string[]', required: true },
      { name: 'axis', type: "'x'|'y'", required: true },
    ],
  },
  {
    name: 'stack',
    description: 'Stack shapes with consistent gaps.',
    params: [
      { name: 'ids', type: 'string[]', required: true },
      { name: 'direction', type: "'row'|'column'", required: true },
      { name: 'gap', type: 'number', notes: 'Pixels between items (default 16).' },
    ],
  },
  {
    name: 'reorder',
    description: 'Change z-order (front/back).',
    params: [
      { name: 'ids', type: 'string[]', required: true },
      { name: 'where', type: "'front'|'back'|'forward'|'backward'", required: true },
    ],
  },
  {
    name: 'delete_shape',
    description: 'Remove shapes. Prefer update/move over delete when iterating.',
    params: [{ name: 'ids', type: 'string[]', required: true }],
  },
  {
    name: 'think',
    description: 'Internal reasoning step (not shown to user). Keep it short.',
    params: [{ name: 'text', type: 'string', required: true }],
  },
  {
    name: 'todo',
    description: 'Persist work items for follow-ups.',
    params: [{ name: 'text', type: 'string', required: true }],
  },
  {
    name: 'add_detail',
    description: 'Request one clarifying detail or follow-up screenshot.',
    params: [
      { name: 'hint', type: 'string', notes: 'Question/task for the next pass.' },
      { name: 'targetIds', type: 'string[]', notes: 'Optional shape ids involved.' },
      { name: 'depth', type: 'number', notes: 'Follow-up nesting; steward fills automatically.' },
    ],
  },
  {
    name: 'set_viewport',
    description: 'Pan/zoom the camera to bounds before continuing.',
    params: [{ name: 'bounds', type: '{ x: number; y: number; w: number; h: number }', required: true }],
  },
];

export function getToolCatalog(): ToolSpec[] {
  return TOOL_SPECS;
}
