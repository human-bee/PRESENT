import type { Editor } from 'tldraw';
import type { customShape } from '../tldraw-canvas';

type ViewportBounds = { width: number; height: number };

type PinnedShapeProps = {
  w: number;
  h: number;
  pinned?: boolean;
  pinnedX?: number;
  pinnedY?: number;
};

type PagePoint = { x: number; y: number };

type PinnedShape = customShape & { props: PinnedShapeProps };

export function getPinnedViewportPoint(viewport: ViewportBounds, props: PinnedShapeProps) {
  const pinnedX = props.pinnedX ?? 0.5;
  const pinnedY = props.pinnedY ?? 0.5;

  return {
    screenX: viewport.width * pinnedX,
    screenY: viewport.height * pinnedY,
  };
}

export function computePinnedShapePosition(pagePoint: PagePoint, props: PinnedShapeProps) {
  return {
    x: pagePoint.x - props.w / 2,
    y: pagePoint.y - props.h / 2,
  };
}

function collectPinnedShapes(editor: Editor): PinnedShape[] {
  const allShapes = editor.getCurrentPageShapes();
  return allShapes.filter(
    (shape): shape is PinnedShape => shape.type === 'custom' && (shape as PinnedShape).props.pinned === true,
  );
}

export function updatePinnedShapes(editor: Editor) {
  const pinnedShapes = collectPinnedShapes(editor);
  if (pinnedShapes.length === 0) {
    return;
  }

  const viewport = editor.getViewportScreenBounds();
  const updates = pinnedShapes.map((shape) => {
    const { screenX, screenY } = getPinnedViewportPoint(viewport, shape.props);
    const pagePoint = editor.screenToPage({ x: screenX, y: screenY });
    const { x, y } = computePinnedShapePosition(pagePoint, shape.props);

    return {
      id: shape.id,
      type: shape.type,
      x,
      y,
    };
  });

  if (updates.length > 0) {
    editor.updateShapes(updates as any);
  }
}

export function registerPinnedShapeHandlers(editor: Editor) {
  let resizeTimer: number | null = null;
  let resizeListenerAttached = false;
  let isUpdating = false;

  const safeUpdate = () => {
    if (isUpdating) {
      return;
    }
    isUpdating = true;
    try {
      updatePinnedShapes(editor);
    } finally {
      isUpdating = false;
    }
  };

  const disposeCamera = editor.sideEffects.registerAfterChangeHandler('camera', safeUpdate);

  if (typeof window !== 'undefined') {
    const handleResize = () => safeUpdate();
    window.addEventListener('resize', handleResize);
    resizeListenerAttached = true;
    resizeTimer = window.setTimeout(safeUpdate, 100);

    return () => {
      disposeCamera();
      if (resizeListenerAttached) {
        window.removeEventListener('resize', handleResize);
      }
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
    };
  }

  safeUpdate();
  return () => {
    disposeCamera();
  };
}
