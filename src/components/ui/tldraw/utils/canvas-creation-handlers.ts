import { nanoid } from 'nanoid';
import { createShapeId, Editor, toRichText } from 'tldraw';
import type { CanvasEventMap, LiveKitBus } from './types';

interface CreateHandlersDeps {
  editor: Editor;
  bus: LiveKitBus;
}

export function createCanvasCreationHandlers({ editor, bus }: CreateHandlersDeps): CanvasEventMap {
  const handleCreateNote: EventListener = (event) => {
    const detail = (event as CustomEvent).detail || {};
    const text: string = (detail.text || '').toString().trim() || 'Note';

    try {
      const viewport = editor.getViewportPageBounds();
      const x = viewport ? viewport.midX : 0;
      const y = viewport ? viewport.midY : 0;
      const noteId = createShapeId(`note-${nanoid()}`);

      editor.createShape({
        id: noteId,
        type: 'note' as any,
        x,
        y,
        props: { scale: 1 },
      } as any);

      try {
        editor.updateShapes([
          { id: noteId, type: 'note' as any, props: { richText: toRichText(text) } },
        ] as any);
      } catch {
        // ignore rich text write failure
      }

      try {
        editor.setEditingShape(noteId);
      } catch {
        // ignore inability to enter edit mode
      }

      try {
        bus.send('editor_action', {
          type: 'create_note',
          shapeId: noteId,
          text,
          timestamp: Date.now(),
        });
      } catch {
        // ignore telemetry send issues
      }
    } catch (error) {
      console.warn('[CanvasControl] create_note error', error);
    }
  };

  const handleCreateRectangle: EventListener = (event) => {
    const detail = (event as CustomEvent).detail || {};
    const w = typeof detail.w === 'number' ? detail.w : 300;
    const h = typeof detail.h === 'number' ? detail.h : 200;

    try {
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
    } catch (error) {
      console.warn('[CanvasControl] create_rectangle error', error);
    }
  };

  const handleCreateEllipse: EventListener = (event) => {
    const detail = (event as CustomEvent).detail || {};
    const w = typeof detail.w === 'number' ? detail.w : 280;
    const h = typeof detail.h === 'number' ? detail.h : 180;

    try {
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
    } catch (error) {
      console.warn('[CanvasControl] create_ellipse error', error);
    }
  };

  const handleDrawSmiley: EventListener = (event) => {
    const detail = (event as CustomEvent).detail || {};
    const size = typeof detail.size === 'number' ? detail.size : 300;

    try {
      const viewport = editor.getViewportPageBounds();
      const cx = viewport ? viewport.midX : 0;
      const cy = viewport ? viewport.midY : 0;

      const faceId = createShapeId(`smiley-face-${nanoid()}`);
      const faceW = size;
      const faceH = size;

      editor.createShape({
        id: faceId,
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
        id: lEyeId,
        type: 'geo' as any,
        x: cx - eyeOffsetX - eyeW / 2,
        y: cy - eyeOffsetY - eyeH / 2,
        props: { w: eyeW, h: eyeH, geo: 'ellipse' },
      } as any);

      const rEyeId = createShapeId(`smiley-eye-r-${nanoid()}`);
      editor.createShape({
        id: rEyeId,
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
        id: mouthId,
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
      } catch {
        // ignore telemetry send issues
      }
    } catch (error) {
      console.warn('[CanvasControl] draw_smiley error', error);
    }
  };

  return {
    'tldraw:create_note': handleCreateNote,
    'tldraw:createRectangle': handleCreateRectangle,
    'tldraw:createEllipse': handleCreateEllipse,
    'tldraw:drawSmiley': handleDrawSmiley,
  };
}
