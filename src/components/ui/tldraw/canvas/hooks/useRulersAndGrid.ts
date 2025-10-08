"use client";

import { useCallback, useMemo, useState } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { getGridSpacing } from '../utils';

export interface RulersAndGridState {
  showGrid: boolean;
  showRulers: boolean;
  majorSpacing: number;
  minorSpacing: number;
  origin: { x: number; y: number };
}

export interface RulersAndGridApi extends RulersAndGridState {
  toggleGrid: () => void;
  toggleRulers: () => void;
}

const BASE_SPACING = 100;

export function useRulersAndGrid(editor: Editor | null): RulersAndGridApi {
  const [showGrid, setShowGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(false);

  const zoom = editor?.getZoomLevel() ?? 1;
  const camera = editor?.getCamera();

  const spacing = useMemo(() => getGridSpacing(zoom, BASE_SPACING), [zoom]);

  const origin = useMemo(() => ({
    x: camera?.x ?? 0,
    y: camera?.y ?? 0,
  }), [camera?.x, camera?.y]);

  const toggleGrid = useCallback(() => setShowGrid((prev) => !prev), []);
  const toggleRulers = useCallback(() => setShowRulers((prev) => !prev), []);

  return {
    showGrid,
    showRulers,
    majorSpacing: spacing.major,
    minorSpacing: spacing.minor,
    origin,
    toggleGrid,
    toggleRulers,
  };
}
