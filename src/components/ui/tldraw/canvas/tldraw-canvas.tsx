"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import type { Editor, TLShapeUtilConstructor } from '@tldraw/tldraw';
import { Tldraw } from '@tldraw/tldraw';
import { useRoomContext } from '@livekit/components-react';
import { CanvasSyncAdapter } from '@/components/CanvasSyncAdapter';
import { InfographicShapeUtil } from '../shapes/InfographicShapeUtil';
import {
  CanvasStoreProvider,
  useCanvasStore,
  useCanvasShortcuts,
  useExportImport,
  useRulersAndGrid,
  useUrlSync,
} from './hooks';
import { useCanvasEventHandlers, usePinnedShapes, useTldrawEditorBridge } from '../hooks';
import {
  CanvasErrorBoundary,
  CanvasHUD,
  CanvasToolbar,
  GridLayer,
  Rulers,
} from './components';
import {
  CanvasToolId,
  DEFAULT_COMPONENT_ID,
  CustomShapeUtil,
  MermaidStreamShapeUtil,
  ToolboxShapeUtil,
} from './utils';

export interface TldrawCanvasProps
  extends Omit<ComponentProps<typeof Tldraw>, 'onMount' | 'shapeUtils'> {
  onMount?: (editor: Editor) => void;
  componentStore?: Map<string, ReactNode>;
  componentId?: string;
  shapeUtils?: readonly AnyShapeUtilConstructor[];
}

type AnyShapeUtilConstructor = TLShapeUtilConstructor<any, any>;

export function TldrawCanvas({
  onMount,
  componentStore,
  componentId: propId,
  shapeUtils: externalShapeUtils,
  ...rest
}: TldrawCanvasProps) {
  const [isClient, setIsClient] = useState(false);
  const [mountedEditor, setMountedEditor] = useState<Editor | null>(null);

  const componentId = propId || DEFAULT_COMPONENT_ID;

  useEffect(() => {
    setIsClient(true);
  }, []);

  const shapeUtils = useMemo(() => {
    const defaults = [
      CustomShapeUtil,
      MermaidStreamShapeUtil,
      ToolboxShapeUtil,
      InfographicShapeUtil,
    ] as readonly AnyShapeUtilConstructor[];
    if (!externalShapeUtils?.length) {
      return defaults;
    }
    return [...defaults, ...externalShapeUtils] as readonly AnyShapeUtilConstructor[];
  }, [externalShapeUtils]);

  if (!isClient) {
    return (
      <div style={{ position: 'fixed', inset: 0 }} className="flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading canvas...</div>
      </div>
    );
  }

  const getItemCount = () => {
    if (!mountedEditor) return 0;
    try {
      return mountedEditor.getCurrentPageShapes().length;
    } catch {
      return 0;
    }
  };

  return (
    <CanvasSyncAdapter componentId={componentId} getItemCount={getItemCount}>
      <CanvasErrorBoundary>
        <CanvasStoreProvider editor={mountedEditor} componentStore={componentStore || null}>
          <CanvasViewport
            componentId={componentId}
            shapeUtils={shapeUtils}
            editor={mountedEditor}
            onEditorReady={setMountedEditor}
            onMount={onMount}
            restProps={rest}
          />
        </CanvasStoreProvider>
      </CanvasErrorBoundary>
    </CanvasSyncAdapter>
  );
}

interface CanvasViewportProps {
  componentId: string;
  shapeUtils: readonly AnyShapeUtilConstructor[];
  editor: Editor | null;
  onEditorReady: (editor: Editor | null) => void;
  onMount?: (editor: Editor) => void;
  restProps: Partial<ComponentProps<typeof Tldraw>>;
}

function CanvasViewport({ componentId, shapeUtils, editor, restProps, onEditorReady, onMount }: CanvasViewportProps) {
  const room = useRoomContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const { exportAs, importJson } = useExportImport(editor);
  const { viewState } = useCanvasStore();
  const rulers = useRulersAndGrid(editor);

  useCanvasShortcuts(editor, { enabled: Boolean(editor) });
  useUrlSync(editor);
  usePinnedShapes(editor, Boolean(editor));
  useTldrawEditorBridge(editor, { onMount });
  useCanvasEventHandlers(editor, room, containerRef, { enabled: Boolean(editor) });

  useEffect(() => {
    onEditorReady(editor ?? null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    const unsafeEditor = editor as any;
    unsafeEditor.setCurrentTool?.(CanvasToolId.Select);
  }, [editor]);

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        shapeUtils={shapeUtils}
        persistenceKey={componentId}
        onMount={(instance) => {
          onEditorReady(instance);
          if (typeof window !== 'undefined') {
            console.log('Exposing Tldraw editor to window');
            (window as any).editor = instance;
          }
          onMount?.(instance);
        }}
        {...restProps}
      />

      <GridLayer
        visible={rulers.showGrid}
        spacing={{ major: rulers.majorSpacing, minor: rulers.minorSpacing }}
      />

      <CanvasToolbar
        onExport={(format) => exportAs(format)}
        onImport={() => importInputRef.current?.click()}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importJson(file);
          event.target.value = '';
        }}
      />

      <CanvasHUD zoom={viewState.zoom} selectionCount={viewState.selectedIds.length} />

      <Rulers
        showHorizontal={rulers.showRulers}
        showVertical={rulers.showRulers}
        majorSpacing={rulers.majorSpacing}
        origin={rulers.origin}
      />
    </div>
  );
}
