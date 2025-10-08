"use client";

import {
  createContext,
  useContext,
  type ReactNode,
  useMemo,
  type ReactElement,
} from 'react';
import { useValue } from '@tldraw/tldraw';
import type { Editor } from '@tldraw/tldraw';

export type CanvasComponentStore = Map<string, ReactNode> | null;

export interface CanvasViewState {
  zoom: number;
  camera: { x: number; y: number; z: number };
  selectedIds: string[];
  currentToolId: string | null;
}

interface CanvasStoreContextValue {
  editor: Editor | null;
  componentStore: CanvasComponentStore;
}

const CanvasStoreContext = createContext<CanvasStoreContextValue>({
  editor: null,
  componentStore: null,
});

export const ComponentStoreContext = createContext<CanvasComponentStore>(null);
export const EditorContext = createContext<Editor | null>(null);

export function useCanvasStoreContext(): CanvasStoreContextValue {
  return useContext(CanvasStoreContext);
}

export function CanvasStoreProvider({
  editor,
  componentStore,
  children,
}: CanvasStoreContextValue & { children: ReactNode }): ReactElement {
  const value = useMemo(() => ({ editor, componentStore }), [editor, componentStore]);

  return (
    <CanvasStoreContext.Provider value={value}>
      <EditorContext.Provider value={editor}>
        <ComponentStoreContext.Provider value={componentStore}>
          {children}
        </ComponentStoreContext.Provider>
      </EditorContext.Provider>
    </CanvasStoreContext.Provider>
  );
}

export function useCanvasViewState(): CanvasViewState {
  const editor = useContext(EditorContext);

  const zoom = useValue(
    'canvas-zoom',
    () => (editor ? editor.getZoomLevel() : 1),
    [editor],
  );

  const camera = useValue(
    'canvas-camera',
    () =>
      editor
        ? editor.getCamera()
        : {
            x: 0,
            y: 0,
            z: 1,
          },
    [editor],
  );

  const selectedIds = useValue(
    'canvas-selected-ids',
    () => (editor ? editor.getSelectedShapeIds() : []),
    [editor],
  );

  const currentToolId = useValue(
    'canvas-current-tool',
    () => (editor ? editor.getCurrentToolId() ?? null : null),
    [editor],
  );

  return {
    zoom,
    camera,
    selectedIds,
    currentToolId,
  };
}

export function useCanvasStore(): CanvasStoreContextValue & { viewState: CanvasViewState } {
  const context = useCanvasStoreContext();
  const viewState = useCanvasViewState();

  return {
    ...context,
    viewState,
  };
}
