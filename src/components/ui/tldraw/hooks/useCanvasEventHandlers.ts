import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import {
  attachMermaidBridge,
  registerWindowListener,
} from '../utils';
import { createCanvasCreationHandlers } from '../utils/canvas-creation-handlers';
import { createCanvasSelectionHandlers } from '../utils/canvas-selection-handlers';
import { createUiStateHandlers } from '../utils/ui-state-handlers';

interface UseCanvasEventHandlersOptions {
  enabled?: boolean;
}

export function useCanvasEventHandlers(
  editor: Editor | null,
  room: Room | undefined,
  containerRef: RefObject<HTMLDivElement>,
  options?: UseCanvasEventHandlersOptions,
) {
  const { enabled = true } = options ?? {};
  const lastTimestampsRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || !editor || !room) {
      return;
    }

    const bus = createLiveKitBus(room);
    const cleanups: Array<() => void> = [];

    const mermaidCleanup = attachMermaidBridge({
      editor,
      bus,
      lastTimestampsRef,
    });
    if (mermaidCleanup) {
      cleanups.push(mermaidCleanup);
    }

    const handlerMaps = [
      createCanvasCreationHandlers({ editor, bus }),
      createCanvasSelectionHandlers({ editor }),
      createUiStateHandlers({ editor, containerRef, bus }),
    ];

    for (const map of handlerMaps) {
      for (const [eventName, handler] of Object.entries(map)) {
        cleanups.push(registerWindowListener(eventName, handler));
      }
    }

    return () => {
      cleanups.forEach((cleanup) => {
        try {
          cleanup();
        } catch {
          // ignore cleanup failures
        }
      });
    };
  }, [enabled, editor, room, containerRef]);
}
