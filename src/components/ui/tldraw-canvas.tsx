"use client";

import { Tldraw, HTMLContainer as TldrawHTMLContainer, RecordProps, T, Editor, BaseBoxShapeUtil, TLBaseShape, createShapeId, useEditor } from 'tldraw';
import { ReactNode, useRef, useEffect, createContext, useContext, Component, ErrorInfo, useState } from 'react';
import React from "react";
import { CanvasSyncAdapter } from '../CanvasSyncAdapter';
import { nanoid } from 'nanoid';
// 1. Import ComponentToolbox
import { ComponentToolbox } from './component-toolbox';
import { getComponentSizeInfo } from '@/lib/component-sizing';
import { ResizeInfo } from 'tldraw';

// Create context for component store
export const ComponentStoreContext = createContext<Map<string, ReactNode> | null>(null);

// Create context for editor instance
export const EditorContext = createContext<Editor | null>(null);

// Define the props for the Tambo shape
export interface TamboShapeProps {
  w: number;
  h: number;
  tamboComponent: string; // Store message ID instead of ReactNode to avoid cloning issues
  name: string;
  pinned?: boolean; // Whether the shape is pinned to viewport
  pinnedX?: number; // Relative X position (0-1) when pinned
  pinnedY?: number; // Relative Y position (0-1) when pinned
}

// Create a type for the Tambo shape
export type TamboShape = TLBaseShape<"tambo", TamboShapeProps>;

// Error boundary for component rendering
class ComponentErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Component render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Component wrapper to handle hooks inside the shape
function TamboShapeComponent({ shape }: { shape: TamboShape }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const scaleWrapperRef = useRef<HTMLDivElement>(null);
    const contentInnerRef = useRef<HTMLDivElement>(null);
    const componentStore = useContext(ComponentStoreContext);
    const editor = useEditor();
    const [, setRenderTick] = useState(0);

    // Measured intrinsic (natural) size of the component's content
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const autoFittedRef = useRef(false);

    useEffect(() => {
      const el = contentInnerRef.current;
      if (!el) return;

      // Measure intrinsic size (not the scaled container)
      const measure = () => {
        // Use scrollWidth/Height to get the natural content size regardless of transforms
        const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
        const h = Math.max(el.scrollHeight, el.getBoundingClientRect().height);
        if (!naturalSize || Math.abs(naturalSize.w - w) > 1 || Math.abs(naturalSize.h - h) > 1) {
          setNaturalSize({ w, h });
        }
      };

      const observer = new ResizeObserver(() => measure());
      observer.observe(el);
      // Initial measure
      measure();

      return () => observer.disconnect();
    }, []);

    // Re-render when component store broadcasts updates
    useEffect(() => {
      const rerender = () => setRenderTick((x) => x + 1);
      if (typeof window !== 'undefined') {
        window.addEventListener('present:component-store-updated', rerender);
      }
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('present:component-store-updated', rerender);
        }
      };
    }, []);

    // Conditional auto-fit based on sizingPolicy and whether user resized
    useEffect(() => {
      if (!editor || !naturalSize) return;

      const sizeInfo = getComponentSizeInfo(shape.props.name);
      const policy = sizeInfo.sizingPolicy || 'fit_until_user_resize';

      // TLDraw Editor.shapeUtils is not a Map in our integration; guard accordingly
      let userHasResized = false;
      try {
        const shapeUtil: any = (editor as any).shapeUtils?.get?.(shape) || (editor as any).shapeUtils?.[shape.type];
        userHasResized = Boolean(shapeUtil?.userResized?.has?.(shape.id));
      } catch {
        userHasResized = false;
      }

      const shouldAutoFit =
        policy === 'always_fit' || (policy === 'fit_until_user_resize' && !userHasResized);

      if (shouldAutoFit) {
        const { w: nw, h: nh } = naturalSize;
        const changed = Math.abs(shape.props.w - nw) > 1 || Math.abs(shape.props.h - nh) > 1;
        if (changed) {
          editor.updateShapes([
            { id: shape.id, type: 'tambo', props: { ...shape.props, w: nw, h: nh } },
          ]);
        }
      }
    }, [editor, naturalSize, shape.id, shape.props.name]);

    // Compute uniform scale to preserve aspect ratio and avoid warping/cropping
    const sizeInfo = getComponentSizeInfo(shape.props.name);
    const baseW = naturalSize?.w ?? sizeInfo.naturalWidth;
    const baseH = naturalSize?.h ?? sizeInfo.naturalHeight;

    const scaleX = shape.props.w / baseW;
    const scaleY = shape.props.h / baseH;
    const scale = Math.min(scaleX, scaleY);

    const scaledWidth = baseW * scale;
    const scaledHeight = baseH * scale;
    const offsetX = (shape.props.w - scaledWidth) / 2;
    const offsetY = (shape.props.h - scaledHeight) / 2;

    return (
      <div
        ref={containerRef}
        style={{
          width: shape.props.w + 'px',
          height: shape.props.h + 'px',
          overflow: 'hidden',
          position: 'relative',
          background: 'transparent',
          pointerEvents: 'all',
        }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (
            target.closest('button') ||
            target.closest('input') ||
            target.closest('select') ||
            target.closest('textarea') ||
            target.closest('[draggable="true"]')
          ) {
            e.stopPropagation();
          }
        }}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('input') || target.closest('select') || target.closest('textarea')) {
            e.stopPropagation();
          }
        }}
      >
        <div
          ref={scaleWrapperRef}
          style={{
            position: 'absolute',
            left: `${offsetX}px`,
            top: `${offsetY}px`,
            width: baseW + 'px',
            height: baseH + 'px',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <div ref={contentInnerRef} style={{ width: 'auto', height: 'auto', display: 'inline-block' }}>
            <ComponentErrorBoundary
              fallback={<div style={{ padding: '10px', color: 'var(--color-text-muted)' }}>Component error</div>}
            >
              {shape.props.tamboComponent && componentStore ? (
                (() => {
                  const stored = componentStore.get(shape.props.tamboComponent) as any;
                  let node: React.ReactNode = null;
                  if (React.isValidElement(stored)) {
                    node = stored;
                  } else if (stored && typeof stored === 'object' && (stored.type || stored.Component || stored.component)) {
                    // Try to reconstruct from { type, props }
                    const type = stored.type || stored.Component || stored.component;
                    const props = stored.props || {};
                    try {
                      node = React.createElement(type, { __tambo_message_id: shape.props.tamboComponent, ...props });
                    } catch {
                      // fall through
                    }
                  }
                  return node || <div style={{ padding: '10px', color: 'var(--color-text-muted)' }}>Component not found</div>;
                })()
              ) : (
                <div style={{ padding: '10px', color: 'var(--color-text-muted)' }}>No component loaded</div>
              )}
            </ComponentErrorBoundary>
          </div>
        </div>
      </div>
    );
}

// Define the TamboShapeUtil class
export class TamboShapeUtil extends BaseBoxShapeUtil<TamboShape> {
  static override type = "tambo" as const;
  static override props = {
    w: T.number,
    h: T.number,
    tamboComponent: T.any,
    name: T.string,
    pinned: T.optional(T.boolean),
    pinnedX: T.optional(T.number),
    pinnedY: T.optional(T.number),
  } satisfies RecordProps<TamboShape>;

  // Track shapes the user has explicitly resized
  private userResized = new Set<string>();

  // Provide default props for the Tambo shape
  override getDefaultProps(): TamboShape['props'] {
    return {
      w: 300,
      h: 200,
      tamboComponent: "",
      name: "Tambo Component",
      pinned: false,
      pinnedX: 0.5,
      pinnedY: 0.5,
    };
  }

  // Render method for the shape
  override component(shape: TamboShape) {
    return (
      <TldrawHTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          overflow: 'visible',
          pointerEvents: 'all',
          position: 'relative',
          width: shape.props.w + 'px',
          height: shape.props.h + 'px',
          zIndex: (shape.props.pinned ?? false) ? 1000 : 100,
        }}
      >
        <TamboShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  // Override indicator for selection, hover, etc.
  override indicator(shape: TamboShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }
  
  // Override canEdit to allow interaction with the content
  override canEdit = () => false;
  
  // Override canResize to allow resizing
  override canResize = () => true;
  
  // Override isAspectRatioLocked to allow free resizing
  override isAspectRatioLocked = () => false;
  
  // Prevent moving pinned shapes
  override canBind = ({ fromShapeType }: { fromShapeType: string }) => {
    return fromShapeType !== 'tambo';
  };

  // Handle TLDraw-initiated resizes with component constraints
  override onResize = (shape: TamboShape, info: ResizeInfo) => {
    // Mark that the user has explicitly resized this shape
    this.userResized.add(shape.id);

    const componentName = shape.props.name; // Component type from name
    const sizeInfo = getComponentSizeInfo(componentName);
    
    console.log(`🔧 [TamboShapeUtil] Resizing ${componentName}:`, { 
      scaleX: info.scaleX, 
      scaleY: info.scaleY, 
      originalSize: { w: shape.props.w, h: shape.props.h } 
    });
    
    // Calculate new dimensions based on the scale factors
    let w = shape.props.w * info.scaleX;
    let h = shape.props.h * info.scaleY;
    
    // Enforce minimum sizes
    w = Math.max(sizeInfo.minWidth, w);
    h = Math.max(sizeInfo.minHeight, h);
    
    // Enforce aspect ratio if needed
    if (sizeInfo.aspectRatio && sizeInfo.resizeMode === 'aspect-locked') {
      const ratio = sizeInfo.aspectRatio;
      // Maintain aspect ratio by adjusting the dimension that changed less
      if (Math.abs(info.scaleX - 1) > Math.abs(info.scaleY - 1)) {
        // Width changed more, adjust height
        h = w / ratio;
      } else {
        // Height changed more, adjust width
        w = h * ratio;
      }
    }
    
    // For fixed mode, snap back to natural size
    if (sizeInfo.resizeMode === 'fixed') {
      w = sizeInfo.naturalWidth;
      h = sizeInfo.naturalHeight;
    }
    
    return { 
      props: {
        ...shape.props, 
        w, 
        h 
      }
    };
  };

  // Expose a method for the component renderer to query if user resized
  public hasUserResized(id: string) {
    return this.userResized.has(id);
  }
}

// Component wrapper for Toolbox inside shape
function ToolboxShapeComponent({ shape }: { shape: TamboShape }) {
  // Use TLDraw's built-in hook to get the editor instead of context
  const editor = useEditor();
  const componentStore = useContext(ComponentStoreContext);
  
  const handleComponentCreate = (componentType: string) => {
    console.log('🔧 Creating component from toolbox:', componentType);
    
    if (!editor || !componentStore) {
      console.error('Editor or component store not available', { editor: !!editor, componentStore: !!componentStore });
      return;
    }
    
    // Import components from tambo
    const { components } = require('@/lib/tambo');
    const Component = components.find((c: any) => c.name === componentType)?.component;
    if (!Component) {
      console.error('Component not found:', componentType);
      return;
    }
    
    const shapeId = createShapeId(nanoid());
    const componentInstance = React.createElement(Component, { __tambo_message_id: shapeId });
    componentStore.set(shapeId, componentInstance);
    
    const viewport = editor.getViewportPageBounds();
    const x = viewport ? viewport.midX - 150 : 0;
    const y = viewport ? viewport.midY - 100 : 0;
    
    editor.createShape({
      id: shapeId,
      type: 'tambo',
      x,
      y,
      props: {
        w: 300,
        h: 200,
        tamboComponent: shapeId,
        name: componentType,
      }
    });
    
    console.log('✅ Component created successfully:', componentType);
  };
  
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: '2px solid var(--color-accent)',
        borderRadius: '12px',
        background: 'var(--color-panel)',
        boxShadow: '0 2px 16px 0 rgba(0,0,0,0.10)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ComponentToolbox onComponentCreate={handleComponentCreate} />
    </div>
  );
}

// 2. Add ToolboxShapeUtil
export class ToolboxShapeUtil extends BaseBoxShapeUtil<TamboShape> {
  static override type = "toolbox" as const;
  static override props = {
    w: T.number,
    h: T.number,
    name: T.string,
  } satisfies RecordProps<TamboShape>;

  override getDefaultProps(): TamboShape['props'] {
    return {
      w: 340,
      h: 320,
      name: "Component Toolbox",
    };
  }

  override component(shape: TamboShape) {
    return (
      <TldrawHTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          overflow: 'visible',
          pointerEvents: 'all',
          position: 'relative',
          zIndex: 1000,
        }}
      >
        <ToolboxShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  override indicator(shape: TamboShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }

  override canEdit = () => false;
  override canResize = () => true;
  override isAspectRatioLocked = () => false;
  override canBind = ({ fromShapeType }: { fromShapeType: string }) => {
    return fromShapeType !== 'toolbox';
  };
}

export interface TldrawCanvasProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[]; // Allow passing custom shape utils
  componentStore?: Map<string, ReactNode>; // Component store for Tambo shapes
  componentId?: string;
  // Add any other props you might need to pass to Tldraw component
}

// Error boundary for tldraw canvas
interface TldrawErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class TldrawErrorBoundary extends Component<{ children: ReactNode }, TldrawErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): TldrawErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error but don't let it crash the app
    console.warn('Tldraw canvas error caught:', error.message);
    
    // Suppress validation errors specifically
    if (error.message.includes('ValidationError') || 
        error.message.includes('Expected a valid url') ||
        error.message.includes('shape(type = bookmark)')) {
      console.warn('Validation error suppressed - this is handled by custom external content handlers');
      return;
    }
    
    console.error('Tldraw error details:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full w-full bg-gray-50">
          <div className="text-center p-8">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Canvas Error</h2>
            <p className="text-gray-500 mb-4">There was an issue with the canvas. Refreshing may help.</p>
            <button 
              onClick={() => this.setState({ hasError: false })}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function TldrawCanvas({ onMount, shapeUtils, componentStore, componentId: propId, ...rest }: TldrawCanvasProps) {
  const [isClient, setIsClient] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  const componentId = propId || 'tldraw-canvas';

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleMount = (editor: Editor) => {
    editorRef.current = editor;
    onMount?.(editor);
  };

  const getItemCount = () => {
    const ed = editorRef.current;
    if (!ed) return 0;
    return Object.keys(ed.store?.getSnapshot().document?.pages || {}).length;
  };

  if (!isClient) {
    return (
      <div style={{ position: 'fixed', inset: 0 }} className="flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading canvas...</div>
      </div>
    );
  }

  return (
    <CanvasSyncAdapter componentId={componentId} getItemCount={getItemCount}>
      <TldrawErrorBoundary>
        <EditorContext.Provider value={editorRef.current}>
          <ComponentStoreContext.Provider value={componentStore || null}>
            <div style={{ position: 'fixed', inset: 0 }}>
              <Tldraw
                onMount={handleMount}
                shapeUtils={shapeUtils || []}
                {...rest}
              />
            </div>
          </ComponentStoreContext.Provider>
        </EditorContext.Provider>
      </TldrawErrorBoundary>
    </CanvasSyncAdapter>
  );
}
