import { z } from 'zod';
import { FAIRY_CONTEXT_PROFILES } from '@/lib/fairy-context/profiles';

const ROUTE_KINDS = [
  'canvas',
  'scorecard',
  'infographic',
  'kanban',
  'view',
  'summary',
  'crowd_pulse',
  'bundle',
  'none',
] as const;
const COMPONENT_TYPES = [
  'DebateScorecard',
  'InfographicWidget',
  'LinearKanbanBoard',
  'CrowdPulseWidget',
] as const;

export const ALLOWED_VIEW_EVENTS = [
  'tldraw:canvas_focus',
  'tldraw:canvas_zoom_all',
  'tldraw:toggleGrid',
  'tldraw:arrangeGrid',
  'tldraw:arrangeSidebar',
  'tldraw:arrangeSpeaker',
  'tldraw:applyViewPreset',
] as const;

export const ALLOWED_VIEW_TARGETS = ['all', 'selected', 'shape', 'component'] as const;

const FastLaneDetailSchema = z
  .object({
    target: z.enum(ALLOWED_VIEW_TARGETS).optional(),
    shapeId: z.string().optional(),
    componentId: z.string().optional(),
    padding: z.number().optional(),
    componentTypes: z.array(z.string()).optional(),
    componentIds: z.array(z.string()).optional(),
    side: z.enum(['left', 'right']).optional(),
    spacing: z.number().optional(),
    preset: z.string().optional(),
    speakerIdentity: z.string().optional(),
    speakerComponentId: z.string().optional(),
    speakerShapeId: z.string().optional(),
    cooldownMs: z.number().optional(),
    force: z.boolean().optional(),
  })
  .passthrough();

const RouteActionSchema = z
  .object({
    kind: z.enum(ROUTE_KINDS),
    confidence: z.number().min(0).max(1).optional(),
    message: z.string().optional(),
    componentType: z.enum(COMPONENT_TYPES).optional(),
    fastLaneEvent: z.enum(ALLOWED_VIEW_EVENTS).optional(),
    contextProfile: z.enum(FAIRY_CONTEXT_PROFILES).optional(),
    fastLaneDetail: FastLaneDetailSchema.optional(),
    summary: z.string().optional(),
  })
  .strict();

export const FairyRouteDecisionSchema = z
  .object({
    kind: z.enum(ROUTE_KINDS),
    confidence: z.number().min(0).max(1),
    message: z.string().optional(),
    componentType: z.enum(COMPONENT_TYPES).optional(),
    fastLaneEvent: z.enum(ALLOWED_VIEW_EVENTS).optional(),
    contextProfile: z.enum(FAIRY_CONTEXT_PROFILES).optional(),
    actions: z.array(RouteActionSchema).optional(),
    fastLaneDetail: FastLaneDetailSchema.optional(),
    summary: z.string().optional(),
  })
  .strict();

export type FairyRouteDecision = z.infer<typeof FairyRouteDecisionSchema>;

const fastLaneDetailProperties = {
  target: { type: 'string', enum: [...ALLOWED_VIEW_TARGETS] },
  shapeId: { type: 'string' },
  componentId: { type: 'string' },
  padding: { type: 'number' },
  componentTypes: { type: 'array', items: { type: 'string' } },
  componentIds: { type: 'array', items: { type: 'string' } },
  side: { type: 'string', enum: ['left', 'right'] },
  spacing: { type: 'number' },
  preset: { type: 'string' },
  speakerIdentity: { type: 'string' },
  speakerComponentId: { type: 'string' },
  speakerShapeId: { type: 'string' },
  cooldownMs: { type: 'number' },
  force: { type: 'boolean' },
};

export const routerTools = [
  {
    type: 'function' as const,
    function: {
      name: 'route_intent',
      description: 'Route a user request to the best target.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...ROUTE_KINDS] },
          confidence: { type: 'number' },
          message: { type: 'string' },
          componentType: { type: 'string', enum: [...COMPONENT_TYPES] },
          fastLaneEvent: { type: 'string', enum: [...ALLOWED_VIEW_EVENTS] },
          contextProfile: { type: 'string', enum: [...FAIRY_CONTEXT_PROFILES] },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: [...ROUTE_KINDS] },
                confidence: { type: 'number' },
                message: { type: 'string' },
                componentType: { type: 'string', enum: [...COMPONENT_TYPES] },
                fastLaneEvent: { type: 'string', enum: [...ALLOWED_VIEW_EVENTS] },
                contextProfile: { type: 'string', enum: [...FAIRY_CONTEXT_PROFILES] },
                fastLaneDetail: {
                  type: 'object',
                  properties: fastLaneDetailProperties,
                  additionalProperties: true,
                },
                summary: { type: 'string' },
              },
              required: ['kind'],
            },
          },
          fastLaneDetail: {
            type: 'object',
            properties: fastLaneDetailProperties,
            additionalProperties: true,
          },
          summary: { type: 'string' },
        },
        required: ['kind', 'confidence'],
      },
    },
  },
];
