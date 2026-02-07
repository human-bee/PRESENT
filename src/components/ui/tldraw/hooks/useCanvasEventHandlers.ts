import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tldraw/tldraw';
import type { Room } from 'livekit-client';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { attachMermaidBridge, attachPromotionBridge, registerWindowListener } from '../utils';
import { createCanvasCreationHandlers } from '../utils/canvas-creation-handlers';
import { createCanvasSelectionHandlers } from '../utils/canvas-selection-handlers';
import { createCanvasPinHandlers } from '../utils/canvas-pin-handlers';
import { createCanvasArrangementHandlers } from '../utils/canvas-arrangement-handlers';
import { createCanvasListShapesHandlers } from '../utils/canvas-list-shapes-handlers';
import { createCanvasNotesHandlers } from '../utils/canvas-notes-handlers';
import { createUiStateHandlers } from '../utils/ui-state-handlers';

interface UseCanvasEventHandlersOptions {
  enabled?: boolean;
}

export function useCanvasEventHandlers(
  editor: Editor | null,
  room: Room | undefined,
  containerRef: RefObject<HTMLDivElement | null>,
  options?: UseCanvasEventHandlersOptions,
) {
  const { enabled = true } = options ?? {};
  const lastTimestampsRef = useRef(new Map<string, number>());
  const bus = useMemo(() => (room ? createLiveKitBus(room) : null), [room]);

  useEffect(() => {
    if (!enabled || !editor || !room || !bus) {
      return;
    }
    const cleanups: Array<() => void> = [];

    const mermaidCleanup = attachMermaidBridge({
      editor,
      bus,
      lastTimestampsRef,
    });
    if (mermaidCleanup) {
      cleanups.push(mermaidCleanup);
    }

    const promotionCleanup = attachPromotionBridge({ editor });
    if (promotionCleanup) {
      cleanups.push(promotionCleanup);
    }

    const handlerMaps = [
      createCanvasCreationHandlers({ editor, bus }),
      createCanvasSelectionHandlers({ editor }),
      createCanvasPinHandlers({ editor, roomName: room?.name }),
      createCanvasArrangementHandlers({ editor, room }),
      createCanvasListShapesHandlers({ editor }),
      createCanvasNotesHandlers({ editor }),
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
  }, [enabled, editor, room, containerRef, bus]);
}
