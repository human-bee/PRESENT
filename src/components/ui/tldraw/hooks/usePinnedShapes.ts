import { useEffect } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { registerPinnedShapeHandlers } from '../utils';

export function usePinnedShapes(editor: Editor | null, enabled = true) {
  useEffect(() => {
    if (!enabled || !editor) {
      return;
    }

    const dispose = registerPinnedShapeHandlers(editor);
    return () => {
      dispose();
    };
  }, [editor, enabled]);
}
