import { Box, FileHelpers } from 'tldraw';
import { PromptPartUtil } from './PromptPartUtil';
export class ScreenshotPartUtil extends PromptPartUtil {
    getPriority() {
        return 40; // screenshot after text content (medium priority)
    }
    async getPart(request) {
        if (!this.agent)
            return { type: 'screenshot', screenshot: null };
        const { editor } = this.agent;
        const contextBounds = request.bounds;
        const contextBoundsBox = Box.From(contextBounds);
        const shapes = editor.getCurrentPageShapesSorted().filter((shape) => {
            if (!editor)
                return false;
            const bounds = editor.getShapeMaskedPageBounds(shape);
            if (!bounds)
                return false;
            return contextBoundsBox.includes(bounds);
        });
        if (shapes.length === 0) {
            return { type: 'screenshot', screenshot: null };
        }
        const largestDimension = Math.max(request.bounds.w, request.bounds.h);
        const scale = largestDimension > 8000 ? 8000 / largestDimension : 1;
        const result = await editor.toImage(shapes, {
            format: 'jpeg',
            background: true,
            bounds: Box.From(request.bounds),
            padding: 0,
            pixelRatio: 1,
            scale,
        });
        return {
            type: 'screenshot',
            screenshot: await FileHelpers.blobToDataUrl(result.blob),
        };
    }
    buildContent({ screenshot }) {
        if (!screenshot)
            return [];
        return [
            'Here is the part of the canvas that you can currently see at this moment. It is not a reference image.',
            screenshot,
        ];
    }
}
ScreenshotPartUtil.type = 'screenshot';
//# sourceMappingURL=ScreenshotPartUtil.js.map