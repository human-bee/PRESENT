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
    const legacyNamespace =
      ((window as any).__present as Record<string, unknown> | undefined) ??
      (((window as any).__present = {}) as Record<string, unknown>);

    const bridge: TldrawBridge = {
      editorId: editor.getInstanceId?.() ?? 'tldraw-editor',
      dispatch: (eventName, detail) => {
        window.dispatchEvent(new CustomEvent(`tldraw:${eventName}`, { detail }));
      },
    };

    namespace.tldraw = bridge;
    try {
      (legacyNamespace as Record<string, unknown> & { tldrawEditor?: Editor }).tldrawEditor = editor;
    } catch {
      // ignore assignment issues from readonly globals
    }

    try {
      window.dispatchEvent(new CustomEvent('tldraw:editor-mounted', { detail: { editorId: bridge.editorId } }));
      window.dispatchEvent(new CustomEvent('present:editor-mounted', { detail: { editor } }));
    } catch {
      // Swallow errors triggered by consumer environments without CustomEvent support
    }

    onMount?.(editor);

    const timerId = window.setTimeout(() => {
      try {
        bridge.dispatch('rehydrate-components');
        window.dispatchEvent(
          new CustomEvent('custom:rehydrateComponents', {
            detail: { editorId: bridge.editorId },
          }),
        );
      } catch {
        // ignore dispatch failures during teardown
      }
    }, rehydrateDelayMs);

    return () => {
      window.clearTimeout(timerId);
      if (namespace.tldraw?.editorId === bridge.editorId) {
        delete namespace.tldraw;
      }
      try {
        const legacy = (window as any).__present as { tldrawEditor?: Editor } | undefined;
        if (legacy?.tldrawEditor === editor) {
          delete legacy.tldrawEditor;
        }
      } catch {
        // ignore cleanup failures
      }
    };
  }, [editor, onMount, rehydrateDelayMs]);
}
