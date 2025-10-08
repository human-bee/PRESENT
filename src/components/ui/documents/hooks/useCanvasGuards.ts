import { useCallback, useMemo } from 'react';
import type { SyntheticEvent } from 'react';

export function useCanvasGuards() {
  const stopPropagation = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const stopAndPrevent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
  }, []);

  return useMemo(() => {
    return {
      onMouseDown: stopAndPrevent,
      onMouseMove: stopPropagation,
      onMouseUp: stopPropagation,
      onClick: stopPropagation,
      onTouchStart: stopAndPrevent,
      onTouchMove: stopAndPrevent,
      onTouchEnd: stopPropagation,
      onWheel: stopPropagation,
      onDragStart: stopPropagation,
      onDragOver: stopPropagation,
      onDrop: stopPropagation,
    } as const;
  }, [stopAndPrevent, stopPropagation]);
}
