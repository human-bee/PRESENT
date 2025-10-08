'use client';

export { TldrawCanvas } from './canvas/tldraw-canvas';
export type { TldrawCanvasProps } from './canvas/tldraw-canvas';

export {
  ComponentStoreContext,
  EditorContext,
  CanvasStoreProvider,
  useCanvasStore,
  type CanvasComponentStore,
  type CanvasViewState,
} from './canvas/hooks/useCanvasStore';

export {
  useCanvasShortcuts,
  useExportImport,
  useRulersAndGrid,
  useUrlSync,
} from './canvas/hooks';

export {
  CanvasErrorBoundary,
  CanvasHUD,
  CanvasToolbar,
  GridLayer,
  Rulers,
} from './canvas/components';

export {
  CustomShapeUtil as customShapeUtil,
  MermaidStreamShapeUtil,
  ToolboxShapeUtil,
  type CustomShape as customShape,
  type MermaidStreamShape,
} from './canvas/utils/shapeUtils';

export type { customShapeProps, MermaidStreamShapeProps } from './canvas/utils/types';

