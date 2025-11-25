import { Editor, AssetRecordType, createShapeId } from '@tldraw/tldraw';
import { registerSingletonWindowListener } from './window-listeners';

interface InfographicBridgeOptions {
    editor: Editor;
}

export function attachInfographicBridge({ editor }: InfographicBridgeOptions) {
    const cleanupFns: Array<() => void> = [];

    const createAssetShapeCleanup = registerSingletonWindowListener(
        '__present_create_asset_shape_handler',
        'tldraw:create_asset_shape',
        (event) => {
            const detail = (event as CustomEvent).detail || {};
            const { url, width, height, type } = detail;

            if (!url || !width || !height) {
                console.warn('[InfographicBridge] Missing required params for create_asset_shape', detail);
                return;
            }

            try {
                const viewport = editor.getViewportPageBounds();
                const x = viewport ? viewport.midX - width / 2 : 0;
                const y = viewport ? viewport.midY - height / 2 : 0;

                const assetId = AssetRecordType.createId();
                const shapeId = createShapeId();

                // Create the Asset record
                const asset: any = {
                    id: assetId,
                    typeName: 'asset',
                    type: 'image',
                    props: {
                        w: width,
                        h: height,
                        name: `infographic-${Date.now()}.png`,
                        src: url,
                        isAnimated: false,
                        mimeType: 'image/png',
                    },
                    meta: {},
                };

                // Create the Shape record linked to the Asset
                editor.createAssets([asset]);
                editor.createShape({
                    id: shapeId,
                    type: 'image',
                    x,
                    y,
                    props: {
                        w: width,
                        h: height,
                        assetId: assetId,
                    },
                });

                console.log('[InfographicBridge] Created asset shape', { shapeId, assetId });
            } catch (err) {
                console.error('[InfographicBridge] Error creating asset shape:', err);
            }
        },
    );
    cleanupFns.push(createAssetShapeCleanup);

    return () => {
        cleanupFns.forEach((cleanup) => {
            try {
                cleanup();
            } catch {
                // ignore
            }
        });
    };
}
