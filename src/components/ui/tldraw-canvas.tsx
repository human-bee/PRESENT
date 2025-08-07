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
    const contentRef = useRef<HTMLDivElement>(null);
    const componentStore = useContext(ComponentStoreContext);
    
    // Helper function to stop event propagation to TLDraw
    const stopEventPropagation = (e: React.SyntheticEvent) => {
        e.stopPropagation();
    };
    
    // Note: Pinned position management is now handled globally via side effects in the mount handler
    // This ensures all pinned shapes are repositioned consistently when camera changes
    
    useEffect(() => {
      const element = contentRef.current;
    if (!element) return;
    
      let debounceTimer: NodeJS.Timeout;
    
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
    
          // Add a small buffer or use Math.round to prevent micro-updates if needed
          const newWidth = Math.max(1, Math.round(width)); // Ensure at least 1px
          const newHeight = Math.max(1, Math.round(height));
    
          // Check if the size has actually changed by a meaningful amount (e.g., > 1px threshold)
          if (Math.abs(newWidth - shape.props.w) > 1 || Math.abs(newHeight - shape.props.h) > 1) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
            // Note: We can't access editor here directly, but this is for demo purposes
            // In a real implementation, you'd need to pass the editor through context
            // Shape size tracking for potential future use
            }, 150); // Debounce for 150ms
          }
        }
      });
    
      observer.observe(element);
    
      return () => {
        clearTimeout(debounceTimer);
        observer.disconnect();
      };
    }, [shape.id, shape.props.w, shape.props.h]); // Dependencies for the effect
    
        // Calculate scale based on current size vs natural size
    const sizeInfo = getComponentSizeInfo(shape.props.name);
    const scaleX = shape.props.w / sizeInfo.naturalWidth;
    const scaleY = shape.props.h / sizeInfo.naturalHeight;
    
    // Use uniform scaling to maintain aspect ratio if needed
    const scale = sizeInfo.resizeMode === 'aspect-locked' 
      ? Math.min(scaleX, scaleY)
      : 1; // For free resize, we'll use a different approach

    return (
        <div
          style={{
            width: shape.props.w + 'px',
            height: shape.props.h + 'px',
            overflow: 'hidden', // Changed from 'auto' to 'hidden' for scaling
            position: 'relative',
            background: 'transparent', // Transparent to show only component bounds
            pointerEvents: 'all',
          }}
          // Only stop propagation for specific interactive elements inside the component
          onPointerDown={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('button') || 
                target.closest('input') || 
                target.closest('select') ||
                target.closest('textarea') ||
                target.closest('[draggable="true"]')) {
              e.stopPropagation();
            }
          }}
          onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('input') || 
                target.closest('select') ||
                target.closest('textarea')) {
              e.stopPropagation();
            }
          }}
        >
          <div 
            ref={contentRef} 
            style={{
              width: sizeInfo.resizeMode === 'aspect-locked' 
                ? sizeInfo.naturalWidth + 'px' 
                : '100%',
              height: sizeInfo.resizeMode === 'aspect-locked' 
                ? sizeInfo.naturalHeight + 'px' 
                : '100%',
              transform: sizeInfo.resizeMode === 'aspect-locked' 
                ? `scale(${scale})` 
                : `scale(${scaleX}, ${scaleY})`,
              transformOrigin: 'top left',
              background: 'var(--color-panel)',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              boxSizing: 'border-box',
            }}>
            <ComponentErrorBoundary
              fallback={<div style={{padding: '10px', color: 'var(--color-text-muted)'}}>Component error</div>}
            >
              {shape.props.tamboComponent && componentStore ? (
                (() => {
                  const component = componentStore.get(shape.props.tamboComponent);
                  
                  if (!component) {
                    console.log(`❌ [TamboShapeComponent] Component not found:`, {
                      shapeId: shape.id,
                      tamboComponent: shape.props.tamboComponent,
                      componentName: shape.props.name,
                      availableComponents: componentStore ? Array.from(componentStore.keys()) : 'no store'
                    });
                  }
                  
                  // Component store contains React elements, which are already valid React children
                  return component || (
                    <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>
                      Component not found: {shape.props.name}
                      <br />
                      <small>ID: {shape.props.tamboComponent}</small>
                    </div>
                  );
                })()
              ) : (
                <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>No component loaded</div>
              )}
            </ComponentErrorBoundary>
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
