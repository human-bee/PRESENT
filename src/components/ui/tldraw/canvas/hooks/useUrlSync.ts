"use client";

import { useEffect } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { parseCanvasStateFromUrl, serializeCanvasStateToUrl } from '../utils';

export function useUrlSync(editor: Editor | null) {
  useEffect(() => {
    if (!editor || typeof window === 'undefined') return;

    const state = parseCanvasStateFromUrl();
    if (typeof state.zoom === 'number') {
      const unsafeEditor = editor as any;
      const camera = unsafeEditor.getCamera?.() ?? { x: 0, y: 0, z: 1 };
      unsafeEditor.setCamera?.({ ...camera, z: state.zoom });
    }
    if (typeof state.x === 'number' && typeof state.y === 'number') {
      const unsafeEditor = editor as any;
      const camera = unsafeEditor.getCamera?.() ?? { z: 1 };
      unsafeEditor.setCamera?.({ x: state.x, y: state.y, z: camera.z });
    }

    const handleChange = () => {
      const unsafeEditor = editor as any;
      const camera = unsafeEditor.getCamera?.() ?? { x: 0, y: 0, z: 1 };
      const next = serializeCanvasStateToUrl({
        zoom: camera.z,
        x: camera.x,
        y: camera.y,
      });
      const url = new URL(window.location.href);
      url.searchParams.set('canvas', next.split('=')[1]);
      window.history.replaceState({}, '', url.toString());
    };

    const unsafeEditor = editor as any;
    const unsubscribe = unsafeEditor.on?.('change-history', handleChange);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [editor]);
}
