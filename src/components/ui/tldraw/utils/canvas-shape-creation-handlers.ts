import { createShapeId } from 'tldraw';
import type { Editor } from 'tldraw';
import { nanoid } from 'nanoid';

import type { LiveKitBus } from './types';
import { withWindowListeners } from './window-listeners';

export function registerCanvasShapeCreationHandlers(editor: Editor, bus: LiveKitBus): () => void {
  return withWindowListeners((add) => {
    const handleCreateRectangle = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const w = typeof detail.w === 'number' ? detail.w : 300;
        const h = typeof detail.h === 'number' ? detail.h : 200;
        const viewport = editor.getViewportPageBounds();
        const x = typeof detail.x === 'number' ? detail.x : viewport ? viewport.midX - w / 2 : 0;
        const y = typeof detail.y === 'number' ? detail.y : viewport ? viewport.midY - h / 2 : 0;
        editor.createShape({
          id: createShapeId(`rect-${nanoid()}`),
          type: 'geo' as any,
          x,
          y,
          props: { w, h, geo: 'rectangle' },
        } as any);
      } catch (err) {
        console.warn('[CanvasControl] create_rectangle error', err);
      }
    };

    const handleCreateEllipse = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const w = typeof detail.w === 'number' ? detail.w : 280;
        const h = typeof detail.h === 'number' ? detail.h : 180;
        const viewport = editor.getViewportPageBounds();
        const x = typeof detail.x === 'number' ? detail.x : viewport ? viewport.midX - w / 2 : 0;
        const y = typeof detail.y === 'number' ? detail.y : viewport ? viewport.midY - h / 2 : 0;
        editor.createShape({
          id: createShapeId(`ellipse-${nanoid()}`),
          type: 'geo' as any,
          x,
          y,
          props: { w, h, geo: 'ellipse' },
        } as any);
      } catch (err) {
        console.warn('[CanvasControl] create_ellipse error', err);
      }
    };

    const handleDrawSmiley = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail || {};
        const size = typeof detail.size === 'number' ? detail.size : 300;
        const viewport = editor.getViewportPageBounds();
        const cx = viewport ? viewport.midX : 0;
        const cy = viewport ? viewport.midY : 0;

        const faceW = size;
        const faceH = size;
        const faceId = createShapeId(`smiley-face-${nanoid()}`);
        editor.createShape({
          id: createShapeId(`smiley-face-${nanoid()}`),
          type: 'geo' as any,
          x: cx - faceW / 2,
          y: cy - faceH / 2,
          props: { w: faceW, h: faceH, geo: 'ellipse' },
        } as any);

        const eyeW = Math.max(16, size * 0.12);
        const eyeH = Math.max(16, size * 0.12);
        const eyeOffsetX = size * 0.22;
        const eyeOffsetY = size * 0.18;

        const lEyeId = createShapeId(`smiley-eye-l-${nanoid()}`);
        editor.createShape({
          id: createShapeId(`smiley-eye-l-${nanoid()}`),
          type: 'geo' as any,
          x: cx - eyeOffsetX - eyeW / 2,
          y: cy - eyeOffsetY - eyeH / 2,
          props: { w: eyeW, h: eyeH, geo: 'ellipse' },
        } as any);

        const rEyeId = createShapeId(`smiley-eye-r-${nanoid()}`);
        editor.createShape({
          id: createShapeId(`smiley-eye-r-${nanoid()}`),
          type: 'geo' as any,
          x: cx + eyeOffsetX - eyeW / 2,
          y: cy - eyeOffsetY - eyeH / 2,
          props: { w: eyeW, h: eyeH, geo: 'ellipse' },
        } as any);

        const mouthW = size * 0.5;
        const mouthH = size * 0.22;
        const mouthY = cy + size * 0.15;
        const mouthId = createShapeId(`smiley-mouth-${nanoid()}`);
        editor.createShape({
          id: createShapeId(`smiley-mouth-${nanoid()}`),
          type: 'geo' as any,
          x: cx - mouthW / 2,
          y: mouthY - mouthH / 2,
          props: { w: mouthW, h: mouthH, geo: 'ellipse' },
        } as any);
        try {
          bus.send('editor_action', {
            type: 'draw_smiley',
            faceId,
            lEyeId,
            rEyeId,
            mouthId,
            size,
            timestamp: Date.now(),
          });
        } catch {}
      } catch (err) {
        console.warn('[CanvasControl] draw_smiley error', err);
      }
    };

    add('tldraw:createRectangle', handleCreateRectangle as EventListener);
    add('tldraw:createEllipse', handleCreateEllipse as EventListener);
    add('tldraw:drawSmiley', handleDrawSmiley as EventListener);
  });
}
