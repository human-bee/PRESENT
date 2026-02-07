import { useEffect } from 'react';
import { Editor, AssetRecordType, createShapeId } from '@tldraw/tldraw';

// Constants for custom MIME types to avoid magic strings
export const DRAG_MIME_TYPE = {
    IGNORE: 'application/x-tldraw-ignore',
    WIDTH: 'application/x-tldraw-width',
    HEIGHT: 'application/x-tldraw-height',
    WIDGET: 'application/x-infographic-widget',
};

interface UseInfographicDropProps {
    editor: Editor;
    currentImage: {
        id: string;
        url: string;
        timestamp: number;
    } | null;
    widgetId: string;
}

export function useInfographicDrop({ editor, currentImage, widgetId }: UseInfographicDropProps) {
    useEffect(() => {
        if (!editor) return;

        const handleGlobalDrop = (e: DragEvent) => {
            // Check if this is our drag event using the custom MIME type
            if (!e.dataTransfer?.types.includes(DRAG_MIME_TYPE.IGNORE)) return;

            // Ensure only the widget that initiated the drag handles the drop
            const sourceWidget = e.dataTransfer?.getData(DRAG_MIME_TYPE.WIDGET);
            if (!sourceWidget || sourceWidget !== widgetId) return;

            console.log('[useInfographicDrop] Global drop caught', { x: e.clientX, y: e.clientY });

            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }

            if (!currentImage) return;

            try {
                // 1. Calculate the drop position in Page coordinates
                const screenPoint = { x: e.clientX, y: e.clientY };
                const pagePoint = editor.screenToPage(screenPoint);

                const assetId = AssetRecordType.createId();
                const shapeId = createShapeId();

                // 2. Retrieve dimensions from dataTransfer or fallback to defaults
                const rawWidth = e.dataTransfer?.getData(DRAG_MIME_TYPE.WIDTH);
                const rawHeight = e.dataTransfer?.getData(DRAG_MIME_TYPE.HEIGHT);

                const width = rawWidth ? parseInt(rawWidth, 10) : 600;
                const height = rawHeight ? parseInt(rawHeight, 10) : 400;

                // 3. Create the Asset record
                const asset: any = {
                    id: assetId,
                    typeName: 'asset',
                    type: 'image',
                    props: {
                        w: width,
                        h: height,
                        name: `infographic-${currentImage.timestamp}.png`,
                        src: currentImage.url,
                        isAnimated: false,
                        mimeType: 'image/png'
                    },
                    meta: {}
                };

                // 4. Create the Shape record linked to the Asset
                console.log('[useInfographicDrop] Creating asset and shape', { assetId, shapeId, pagePoint, width, height });

                editor.createAssets([asset]);
                editor.createShape({
                    id: shapeId,
                    type: 'image',
                    x: pagePoint.x - (width / 2), // Center on mouse
                    y: pagePoint.y - (height / 2),
                    props: {
                        w: width,
                        h: height,
                        assetId: assetId
                    }
                });
            } catch (err) {
                console.error('[useInfographicDrop] Error in global drop handler:', err);
            }
        };

        // Use capture phase to intercept the event before Tldraw's internal handlers
        window.addEventListener('drop', handleGlobalDrop, true);
        return () => window.removeEventListener('drop', handleGlobalDrop, true);
    }, [editor, currentImage, widgetId]);
}
