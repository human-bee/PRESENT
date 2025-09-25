import * as React from 'react';

type TileOverlayControls = {
  overlayVisible: boolean;
  hovering: boolean;
  isCoarsePointer: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
};

export function useTileOverlay(): TileOverlayControls {
  const [overlayVisible, setOverlayVisible] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = React.useState(false);
  const showTimerRef = React.useRef<number | null>(null);
  const hideTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(pointer: coarse)');
    const update = (value: boolean) => {
      setIsCoarsePointer(value);
      if (value) setOverlayVisible(true);
    };

    update(!!mql.matches);

    const onChange = (event: MediaQueryListEvent) => update(event.matches);

    try {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    } catch {
      const legacy = mql as unknown as {
        addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
        removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener?.(onChange);
      return () => legacy.removeListener?.(onChange);
    }
  }, []);

  const clearTimers = React.useCallback(() => {
    if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
  }, []);

  const onPointerEnter = React.useCallback(() => {
    if (isCoarsePointer) return;
    setHovering(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (!overlayVisible) {
      showTimerRef.current = window.setTimeout(() => setOverlayVisible(true), 600);
    }
  }, [isCoarsePointer, overlayVisible]);

  const onPointerLeave = React.useCallback(() => {
    if (isCoarsePointer) return;
    setHovering(false);
    if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setOverlayVisible(false), 1500);
  }, [isCoarsePointer]);

  React.useEffect(() => clearTimers, [clearTimers]);

  return {
    overlayVisible,
    hovering,
    isCoarsePointer,
    onPointerEnter,
    onPointerLeave,
  };
}
