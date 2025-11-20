import { Box } from 'tldraw';
import { convertTldrawShapeToBlurryShape } from '../format/convertTldrawShapeToBlurryShape';
import { PromptPartUtil } from './PromptPartUtil';
export class BlurryShapesPartUtil extends PromptPartUtil {
    getPriority() {
        return 70;
    }
    getPart(request, helpers) {
        if (!this.agent)
            return { type: 'blurryShapes', shapes: null };
        const { editor } = this.agent;
        const shapes = editor.getCurrentPageShapesSorted();
        const contextBoundsBox = Box.From(request.bounds);
        // Get all shapes within the agent's viewport
        const shapesInBounds = shapes.filter((shape) => {
            if (!editor)
                return false;
            const bounds = editor.getShapeMaskedPageBounds(shape);
            if (!bounds)
                return false;
            return contextBoundsBox.includes(bounds);
        });
        // Convert the shapes to the blurry shape format
        const blurryShapes = shapesInBounds
            .map((shape) => {
            if (!editor)
                return null;
            return convertTldrawShapeToBlurryShape(editor, shape);
        })
            .filter((s) => s !== null);
        // Apply the offset and round the blurry shapes
        const normalizedBlurryShapes = blurryShapes.map((shape) => {
            const bounds = helpers.roundBox(helpers.applyOffsetToBox({
                x: shape.x,
                y: shape.y,
                w: shape.w,
                h: shape.h,
            }));
            return { ...shape, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
        });
        return {
            type: 'blurryShapes',
            shapes: normalizedBlurryShapes,
        };
    }
    buildContent({ shapes }) {
        if (!shapes || shapes.length === 0)
            return ['There are no shapes in your view at the moment.'];
        return [`These are the shapes you can currently see:`, JSON.stringify(shapes)];
    }
}
BlurryShapesPartUtil.type = 'blurryShapes';
//# sourceMappingURL=BlurryShapesPartUtil.js.map