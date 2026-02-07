import { nanoid } from 'nanoid';
import { createShapeId, Editor, toRichText } from '@tldraw/tldraw';
import type { CanvasEventMap, LiveKitBus } from './types';
import { createLogger } from '@/lib/utils';

interface CreateHandlersDeps {
  editor: Editor;
  bus: LiveKitBus;
}

export function createCanvasCreationHandlers({ editor, bus }: CreateHandlersDeps): CanvasEventMap {
  const logger = createLogger('CanvasCreationHandlers');
  const getViewport = () => {
    try {
      return editor.getViewportPageBounds();
    } catch {
      return null;
    }
  };

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
      logger.warn('create_note error', error);
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
      logger.warn('create_rectangle error', error);
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
      logger.warn('create_ellipse error', error);
    }
  };

  const handleCreateArrow: EventListener = (event) => {
    const detail = (event as CustomEvent).detail || {};
    const from = typeof detail.from === 'string' ? detail.from : undefined;
    const to = typeof detail.to === 'string' ? detail.to : undefined;
    const label = typeof detail.label === 'string' ? detail.label : undefined;
    const start = detail.start;
    const end = detail.end;

    try {
      const arrowId = createShapeId(`arrow-${nanoid()}`);
      const props: Record<string, unknown> = {};
      if (label) props.text = label;
      if (from) props.start = { type: 'binding', boundShapeId: from };
      if (to) props.end = { type: 'binding', boundShapeId: to };
      if (!from && !start) {
        props.start = { type: 'point', x: 0, y: 0 };
      } else if (start && typeof start === 'object') {
        props.start = start;
      }
      if (!to && !end) {
        props.end = { type: 'point', x: 320, y: 0 };
      } else if (end && typeof end === 'object') {
        props.end = end;
      }

      const viewport = editor.getViewportPageBounds();
      const cx = viewport ? viewport.midX : 0;
      const cy = viewport ? viewport.midY : 0;

      editor.createShape({
        id: arrowId,
        type: 'arrow' as any,
        x: cx,
        y: cy,
        props,
      } as any);
    } catch (error) {
      logger.warn('create_arrow error', error);
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
      logger.warn('draw_smiley error', error);
    }
  };

  const handleCreateShape: EventListener = (event) => {
    const detail = (event as CustomEvent).detail || {};
    const type = typeof detail.type === 'string' ? detail.type : undefined;

    // Toggle-able toolbox shortcut used by CanvasToolbar + agent actions
    if (type === 'toolbox') {
      try {
        const existingToolbox = editor.getCurrentPageShapes().find((shape) => shape.type === 'toolbox');
        if (existingToolbox) {
          editor.deleteShapes([existingToolbox.id]);
          logger.info('🗑️ Removed existing component toolbox via event');
          return;
        }

        const viewport = getViewport();
        const w = typeof detail?.props?.w === 'number' ? detail.props.w : 56;
        const h = typeof detail?.props?.h === 'number' ? detail.props.h : 560;
        const x = typeof detail.x === 'number' ? detail.x : viewport ? viewport.minX + 24 : 24;
        const y = typeof detail.y === 'number' ? detail.y : viewport ? viewport.midY - h / 2 : 24;

        editor.createShape({
          id: createShapeId(detail.id ?? `toolbox-${nanoid()}`),
          type: 'toolbox' as any,
          x,
          y,
          props: {
            w,
            h,
            name: typeof detail?.props?.name === 'string' ? detail.props.name : 'Component Toolbox',
          },
        } as any);

        logger.info('✅ Created component toolbox via event');
      } catch (error) {
        logger.warn('create_shape toolbox error', error);
      }
      return;
    }

    if (!type) {
      logger.warn('create_shape event missing type');
      return;
    }

    try {
      const viewport = getViewport();
      const w = typeof detail?.props?.w === 'number' ? detail.props.w : 300;
      const h = typeof detail?.props?.h === 'number' ? detail.props.h : 200;
      const x = typeof detail.x === 'number' ? detail.x : viewport ? viewport.midX - w / 2 : 0;
      const y = typeof detail.y === 'number' ? detail.y : viewport ? viewport.midY - h / 2 : 0;

      editor.createShape({
        id: createShapeId(detail.id ?? `${type}-${nanoid()}`),
        type: type as any,
        x,
        y,
        props: detail.props ?? { w, h },
      } as any);
    } catch (error) {
      logger.warn('create_shape error', error);
    }
  };

  return {
    'tldraw:create_note': handleCreateNote,
    'tldraw:createRectangle': handleCreateRectangle,
    'tldraw:createEllipse': handleCreateEllipse,
    'tldraw:createArrow': handleCreateArrow,
    'tldraw:drawSmiley': handleDrawSmiley,
    'tldraw:create_shape': handleCreateShape,
  };
}
