import z from 'zod';
export const SimpleFillSchema = z.enum(['none', 'tint', 'background', 'solid', 'pattern']);
const SIMPLE_TO_SHAPE_FILLS = {
    none: 'none',
    solid: 'lined-fill',
    background: 'semi',
    tint: 'solid',
    pattern: 'pattern',
};
const SHAPE_TO_SIMPLE_FILLS = {
    none: 'none',
    fill: 'solid',
    'lined-fill': 'solid',
    semi: 'background',
    solid: 'tint',
    pattern: 'pattern',
};
export function convertSimpleFillToTldrawFill(fill) {
    return SIMPLE_TO_SHAPE_FILLS[fill];
}
export function convertTldrawFillToSimpleFill(fill) {
    return SHAPE_TO_SIMPLE_FILLS[fill];
}
//# sourceMappingURL=SimpleFill.js.map