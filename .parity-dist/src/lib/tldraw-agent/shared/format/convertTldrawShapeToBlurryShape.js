import { convertTldrawIdToSimpleId, convertTldrawShapeToSimpleType, } from './convertTldrawShapeToSimpleShape';
/**
 * Convert a tldraw shape to the blurry shape format
 */
export function convertTldrawShapeToBlurryShape(editor, shape) {
    const bounds = editor.getShapeMaskedPageBounds(shape);
    if (!bounds)
        return null;
    const util = editor.getShapeUtil(shape);
    const text = util.getText(shape);
    const shapeType = convertTldrawShapeToSimpleType(shape);
    return {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        w: Math.round(bounds.w),
        h: Math.round(bounds.h),
        type: shapeType,
        shapeId: convertTldrawIdToSimpleId(shape.id),
        text,
    };
}
//# sourceMappingURL=convertTldrawShapeToBlurryShape.js.map