import type { Editor } from '@tldraw/tldraw';
import type { RefObject } from 'react';
import type { CanvasEventMap } from './types';

function createFocusHandler(editor: Editor) {
  return (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const target: 'all' | 'selected' | 'component' | 'shape' = detail.target || 'all';
    const padding: number = typeof detail.padding === 'number' ? detail.padding : 64;

    try {
      if (target === 'all') {
        if ((editor as any).zoomToFit) {
          (editor as any).zoomToFit();
        } else {
          const bounds = editor.getCurrentPageBounds();
          if (bounds && (editor as any).zoomToBounds) {
            (editor as any).zoomToBounds(bounds, {
              animation: { duration: 320 },
              inset: padding,
            });
          }
        }
        return;
      }

      if (target === 'selected') {
        if ((editor as any).zoomToSelection) {
          (editor as any).zoomToSelection({ inset: padding });
          return;
        }
      }

      let shapeId: string | null = null;
      if (target === 'shape' && detail.shapeId) {
        shapeId = detail.shapeId;
      }
      if (target === 'component' && detail.componentId) {
        const custom = editor
          .getCurrentPageShapes()
          .find(
            (s: any) => s.type === 'custom' && s.props?.customComponent === detail.componentId,
          );
        shapeId = custom?.id ?? null;
      }

      if (shapeId) {
        const bounds = editor.getShapePageBounds(shapeId as any);
        if (bounds && (editor as any).zoomToBounds) {
          (editor as any).zoomToBounds(bounds, {
            animation: { duration: 320 },
            inset: padding,
          });
        }
      }
    } catch (err) {
      console.warn('[CanvasControl] focus error', err);
    }
  };
}

function createZoomAllHandler(editor: Editor) {
  return () => {
    try {
      if ((editor as any).zoomToFit) {
        (editor as any).zoomToFit();
        return;
      }
      const bounds = editor.getCurrentPageBounds();
      if (bounds && (editor as any).zoomToBounds) {
        (editor as any).zoomToBounds(bounds, { animation: { duration: 320 } });
      }
    } catch (err) {
      console.warn('[CanvasControl] zoomAll error', err);
    }
  };
}

function createToggleGridHandler(containerRef: RefObject<HTMLDivElement>) {
  return () => {
    const el = containerRef.current;
    if (!el) return;
    const has = el.dataset.grid === 'on';
    if (has) {
      delete el.dataset.grid;
      el.style.backgroundImage = '';
    } else {
      el.dataset.grid = 'on';
      el.style.backgroundImage = 'radial-gradient(circle, rgba(0,0,0,0.12) 1px, transparent 1px)';
      el.style.backgroundSize = '16px 16px';
    }
  };
}

function createBackgroundHandler(containerRef: RefObject<HTMLDivElement>) {
  return (event: Event) => {
    const el = containerRef.current;
    if (!el) return;
    const detail = (event as CustomEvent).detail || {};
    if (detail.color) {
      el.style.backgroundColor = String(detail.color);
      if (el.dataset.grid !== 'on') el.style.backgroundImage = '';
    } else if (detail.image) {
      el.style.backgroundImage = `url(${detail.image})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    }
  };
}

function createThemeHandler(containerRef: RefObject<HTMLDivElement>) {
  return (event: Event) => {
    const el = containerRef.current;
    if (!el) return;
    const detail = (event as CustomEvent).detail || {};
    const theme = String(detail.theme || '').toLowerCase();
    el.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  };
}

export function createCanvasNavigationHandlers(
  editor: Editor,
  containerRef: RefObject<HTMLDivElement>,
): CanvasEventMap {
  return {
    'tldraw:canvas_focus': createFocusHandler(editor),
    'tldraw:canvas_zoom_all': createZoomAllHandler(editor),
    'tldraw:toggleGrid': createToggleGridHandler(containerRef),
    'tldraw:setBackground': createBackgroundHandler(containerRef),
    'tldraw:setTheme': createThemeHandler(containerRef),
  };
}
