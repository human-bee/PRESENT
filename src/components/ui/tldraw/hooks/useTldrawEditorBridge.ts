import { useEffect } from 'react';
import type { Editor } from '@tldraw/tldraw';

interface TldrawEditorBridgeOptions {
  onMount?: (editor: Editor) => void;
  rehydrateDelayMs?: number;
}

const DEFAULT_REHYDRATE_DELAY = 250;

type TldrawBridge = {
  editorId: string;
  dispatch: (eventName: string, detail?: unknown) => void;
};

declare global {
  interface Window {
    __PRESENT__?: Record<string, unknown> & { tldraw?: TldrawBridge };
  }
}

function ensureBridgeNamespace(): Record<string, unknown> & { tldraw?: TldrawBridge } {
  if (typeof window === 'undefined') {
    throw new Error('useTldrawEditorBridge requires window context');
  }
  if (!window.__PRESENT__) {
    window.__PRESENT__ = {};
  }
  return window.__PRESENT__ as Record<string, unknown> & { tldraw?: TldrawBridge };
}

export function useTldrawEditorBridge(editor: Editor | null, options?: TldrawEditorBridgeOptions) {
  const { onMount, rehydrateDelayMs = DEFAULT_REHYDRATE_DELAY } = options ?? {};

  useEffect(() => {
    if (!editor || typeof window === 'undefined') {
      return;
    }

    const namespace = ensureBridgeNamespace();
    const bridge: TldrawBridge = {
      editorId: editor.getInstanceId?.() ?? 'tldraw-editor',
      dispatch: (eventName, detail) => {
        window.dispatchEvent(new CustomEvent(`tldraw:${eventName}`, { detail }));
      },
    };

    namespace.tldraw = bridge;

    try {
      window.dispatchEvent(new CustomEvent('tldraw:editor-mounted', { detail: { editorId: bridge.editorId } }));
    } catch {
      // Swallow errors triggered by consumer environments without CustomEvent support
    }

    onMount?.(editor);

    const timerId = window.setTimeout(() => {
      try {
        bridge.dispatch('rehydrate-components');
      } catch {
        // ignore dispatch failures during teardown
      }
    }, rehydrateDelayMs);

    return () => {
      window.clearTimeout(timerId);
      if (namespace.tldraw?.editorId === bridge.editorId) {
        delete namespace.tldraw;
      }
    };
  }, [editor, onMount, rehydrateDelayMs]);
}
