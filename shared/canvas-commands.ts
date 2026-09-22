import { z } from 'zod';

const coordinate = z.number().finite().min(-100000).max(100000);
const dimension = z.number().finite().min(1).max(4000);
const text = z.string().max(6000);
const color = z.enum(['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white']);
const fill = z.enum(['none', 'semi', 'solid', 'pattern']);
const geo = z.enum(['rectangle', 'ellipse', 'triangle', 'diamond', 'star', 'cloud']);
const shapeId = z.string().regex(/^shape:[a-zA-Z0-9_-]{1,100}$/);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const points = z.array(point).min(2).max(256);
const reference = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const placement = z.object({ x: coordinate, y: coordinate, ref: reference.optional() }).strict();
const anchor = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().default({ x: .5, y: .5 });
const binding = z.union([z.object({ toId: shapeId, anchor }).strict(), z.object({ toRef: reference, anchor }).strict()]);
const geoProps = z.object({ w: dimension, h: dimension, geo, text, color, fill }).strict();
const textProps = z.object({ text, w: dimension, color }).strict();
const arrowProps = z.object({ start: point, end: point, text, color, bend: coordinate }).strict();
const drawProps = z.object({ points, color, isClosed: z.boolean() }).strict();
const patch = z.discriminatedUnion('shapeType', [
  z.object({ shapeType: z.literal('geo'), props: geoProps.partial() }).strict(),
  z.object({ shapeType: z.literal('text'), props: textProps.partial() }).strict(),
  z.object({ shapeType: z.literal('note'), props: z.object({ text, color }).partial().strict() }).strict(),
  z.object({ shapeType: z.literal('arrow'), props: arrowProps.partial() }).strict(),
  z.object({ shapeType: z.literal('draw'), props: drawProps.partial() }).strict(),
]);

/** A deliberately small command vocabulary. Invalid intent is rejected, never rewritten. */
export const canvasCommandSchema = z.discriminatedUnion('type', [
  placement.extend({ type: z.literal('create_geo'), w: dimension, h: dimension, geo, text: text.default(''), color: color.default('black'), fill: fill.default('none') }),
  placement.extend({ type: z.literal('create_text'), text: text.min(1), w: dimension.default(300), color: color.default('black') }),
  placement.extend({ type: z.literal('create_note'), text: text.min(1), color: color.default('yellow') }),
  placement.extend({ type: z.literal('create_arrow'), start: point, end: point, text: text.default(''), color: color.default('black'), bend: coordinate.default(0), startBinding: binding.optional(), endBinding: binding.optional() }),
  placement.extend({ type: z.literal('create_draw'), points, color: color.default('black'), isClosed: z.boolean().default(false) }),
  z.object({ type: z.literal('update_shape'), id: shapeId, x: coordinate.optional(), y: coordinate.optional(), rotation: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2).optional(), patch }).strict(),
  z.object({ type: z.literal('delete_shape'), id: shapeId }).strict(),
]);
export const canvasToolSchemas = {
  read_canvas: z.object({ pageId: z.string().regex(/^page:[a-zA-Z0-9_-]{1,100}$/).optional(), scope: z.enum(['viewport', 'selection', 'page']).default('viewport'), includeImage: z.boolean().default(false) }).strict(),
  apply_canvas: z.object({ pageId: z.string().regex(/^page:[a-zA-Z0-9_-]{1,100}$/), commands: z.array(canvasCommandSchema).min(1).max(20) }).strict(),
};
export type CanvasCommand = z.infer<typeof canvasCommandSchema>;
export type CanvasBatch = z.infer<typeof canvasToolSchemas.apply_canvas>;
export const canvasToolNames = ['read_canvas', 'apply_canvas'] as const;

export type CanvasScope = 'viewport' | 'selection' | 'page';
export type CanvasViewContext = {
  pageId: string; capturedAt: number; selectedIds: string[];
  viewport: { x: number; y: number; w: number; h: number; z?: number };
  shapes: Array<{ id: string; type: string; x: number; y: number; bounds?: { x: number; y: number; w: number; h: number }; text?: string; title?: string }>;
};
export type CanvasStill = { dataUrl: string; caption: string; scope: CanvasScope; capturedAt: number; omittedWidgetIds?: string[] };
export type CanvasContextProvider = { control?: (input: unknown) => Promise<unknown>; read: (includeIds?: string[]) => CanvasViewContext | null; capture?: (scope: CanvasScope) => Promise<CanvasStill | null>; reveal?: (ids: string[]) => void };
