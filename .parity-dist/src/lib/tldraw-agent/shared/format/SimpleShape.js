import { z } from 'zod';
import { SimpleColor } from './SimpleColor';
import { SimpleFillSchema } from './SimpleFill';
import { SimpleFontSize } from './SimpleFontSize';
import { SimpleGeoShapeTypeSchema } from './SimpleGeoShapeType';
const SimpleLabel = z.string();
export const SimpleGeoShape = z.object({
    _type: SimpleGeoShapeTypeSchema,
    color: SimpleColor,
    fill: SimpleFillSchema,
    h: z.number(),
    note: z.string(),
    shapeId: z.string(),
    text: SimpleLabel.optional(),
    textAlign: z.enum(['start', 'middle', 'end']).optional(),
    w: z.number(),
    x: z.number(),
    y: z.number(),
});
const SimpleLineShape = z.object({
    _type: z.literal('line'),
    color: SimpleColor,
    note: z.string(),
    shapeId: z.string(),
    x1: z.number(),
    x2: z.number(),
    y1: z.number(),
    y2: z.number(),
});
const SimpleNoteShape = z.object({
    _type: z.literal('note'),
    color: SimpleColor,
    note: z.string(),
    shapeId: z.string(),
    text: SimpleLabel.optional(),
    x: z.number(),
    y: z.number(),
});
const SimpleTextShape = z.object({
    _type: z.literal('text'),
    color: SimpleColor,
    fontSize: SimpleFontSize.optional(),
    note: z.string(),
    shapeId: z.string(),
    text: SimpleLabel,
    textAlign: z.enum(['start', 'middle', 'end']).optional(),
    width: z.number().optional(),
    wrap: z.boolean().optional(),
    x: z.number(),
    y: z.number(),
});
const SimpleArrowShape = z.object({
    _type: z.literal('arrow'),
    color: SimpleColor,
    fromId: z.string().nullable(),
    note: z.string(),
    shapeId: z.string(),
    text: z.string().optional(),
    toId: z.string().nullable(),
    x1: z.number(),
    x2: z.number(),
    y1: z.number(),
    y2: z.number(),
    bend: z.number().optional(),
});
const SimpleDrawShape = z
    .object({
    _type: z.literal('draw'),
    color: SimpleColor,
    fill: SimpleFillSchema.optional(),
    note: z.string(),
    shapeId: z.string(),
});
const SimpleUnknownShape = z
    .object({
    _type: z.literal('unknown'),
    note: z.string(),
    shapeId: z.string(),
    subType: z.string(),
    x: z.number(),
    y: z.number(),
});
const SIMPLE_SHAPES = [
    SimpleDrawShape,
    SimpleGeoShape,
    SimpleLineShape,
    SimpleTextShape,
    SimpleArrowShape,
    SimpleNoteShape,
    SimpleUnknownShape,
];
export const SimpleShapeSchema = z.union(SIMPLE_SHAPES);
/**
 * Extract all shape type names from the schema
 */
export function getSimpleShapeSchemaNames() {
    const typeNames = [];
    for (const shapeSchema of SIMPLE_SHAPES) {
        const typeField = shapeSchema.shape._type;
        if (typeField) {
            // Handle ZodLiterals (like SimpleDrawShape)
            if ('value' in typeField && typeof typeField.value === 'string') {
                typeNames.push(typeField.value);
            }
            // Handle ZodEnums (like SimpleGeoShape)
            else if ('options' in typeField && Array.isArray(typeField.options)) {
                typeNames.push(...typeField.options);
            }
        }
    }
    return typeNames;
}
//# sourceMappingURL=SimpleShape.js.map