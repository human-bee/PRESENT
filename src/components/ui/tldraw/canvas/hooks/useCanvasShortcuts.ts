"use client";

import { useEffect, useRef } from 'react';
import type { Editor } from '@tldraw/tldraw';

export interface CanvasShortcutOptions {
  enabled?: boolean;
}

export function useCanvasShortcuts(editor: Editor | null, options: CanvasShortcutOptions = {}): void {
  const { enabled = true } = options;
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;
      const unsafeEditor = currentEditor as any;

      const isMod = event.metaKey || event.ctrlKey;

      if (isMod && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        unsafeEditor.zoomIn?.(unsafeEditor.getViewportScreenCenter?.(), {
          animation: { duration: 160 },
        });
      }

      if (isMod && event.key === '-') {
        event.preventDefault();
        unsafeEditor.zoomOut?.(unsafeEditor.getViewportScreenCenter?.(), {
          animation: { duration: 160 },
        });
      }

      if (isMod && event.key === '0') {
        event.preventDefault();
        unsafeEditor.resetZoom?.(unsafeEditor.getViewportScreenCenter?.(), {
          animation: { duration: 160 },
        });
      }

      if (event.key === 'Escape') {
        unsafeEditor.setCurrentTool?.('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
