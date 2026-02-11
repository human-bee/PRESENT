import { useEffect } from 'react';
import type { Editor, TLShapeId } from 'tldraw';

import type { CanvasLogger } from './useCanvasComponentStore';
import type React from 'react';

interface ThreadResetParams {
  thread: { id?: string } | null | undefined;
  editor: Editor | null;
  componentStore: React.MutableRefObject<Map<string, React.ReactNode>>;
  setMessageIdToShapeIdMap: (value: Map<string, TLShapeId>) => void;
  setAddedMessageIds: (value: Set<string>) => void;
  previousThreadId: React.MutableRefObject<string | null>;
  logger: CanvasLogger;
}

export function useCanvasThreadReset({
  thread,
  editor,
  componentStore,
  setMessageIdToShapeIdMap,
  setAddedMessageIds,
  previousThreadId,
  logger,
}: ThreadResetParams) {
  useEffect(() => {
    if (!thread || (previousThreadId.current && previousThreadId.current !== thread.id)) {
      if (editor) {
        const allShapes = editor.getCurrentPageShapes();
        if (allShapes.length > 0) {
          editor.deleteShapes(allShapes.map((s) => s.id));
        }
      }
      setMessageIdToShapeIdMap(new Map());
      setAddedMessageIds(new Set());
      componentStore.current.clear();
      logger.info('🧹 Cleared canvas state after thread change');
    }
    previousThreadId.current = thread?.id ?? null;
  }, [thread, editor, componentStore, setMessageIdToShapeIdMap, setAddedMessageIds, previousThreadId, logger]);
}
