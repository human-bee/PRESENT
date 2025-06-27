"use client";

import { Tldraw, HTMLContainer as TldrawHTMLContainer, RecordProps, T, Editor, BaseBoxShapeUtil, TLBaseShape } from 'tldraw';
import { ReactNode, useRef, useEffect, createContext, useContext, Component, ErrorInfo, useState } from 'react';
import { CanvasSyncAdapter } from '../CanvasSyncAdapter';

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

// Component wrapper to handle hooks inside the shape
function TamboShapeComponent({ shape }: { shape: TamboShape }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const componentStore = useContext(ComponentStoreContext);

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

    return (
        <div
          style={{
            pointerEvents: 'all',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        position: 'relative',
        zIndex: (shape.props.pinned ?? false) ? 10000 : 1000, // Higher z-index when pinned
      }}
      // Prevent TLDraw from handling events on interactive elements
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        // Check if the clicked element is interactive
        if (target.tagName === 'BUTTON' || 
            target.tagName === 'INPUT' || 
            target.tagName === 'SELECT' ||
            target.tagName === 'TEXTAREA' ||
            target.closest('button') ||
            target.closest('[role="button"]') ||
            target.closest('input') ||
            target.closest('select') ||
            target.closest('textarea')) {
          e.stopPropagation(); // Prevent TLDraw from handling this event
        }
      }}
      onPointerUp={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON' || 
            target.tagName === 'INPUT' || 
            target.tagName === 'SELECT' ||
            target.tagName === 'TEXTAREA' ||
            target.closest('button') ||
            target.closest('[role="button"]') ||
            target.closest('input') ||
            target.closest('select') ||
            target.closest('textarea')) {
          e.stopPropagation();
        }
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON' || 
            target.tagName === 'INPUT' || 
            target.tagName === 'SELECT' ||
            target.tagName === 'TEXTAREA' ||
            target.closest('button') ||
            target.closest('[role="button"]') ||
            target.closest('input') ||
            target.closest('select') ||
            target.closest('textarea')) {
          e.stopPropagation();
        }
          }}
        >
          <div ref={contentRef} style={{
            minWidth: '1px',
            minHeight: '1px',
        display: 'block',
        pointerEvents: 'all',
        width: '100%',
        height: '100%',
          }}>
            {shape.props.tamboComponent && componentStore ? 
              componentStore.get(shape.props.tamboComponent) || <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>Component not found</div>
              : <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>No component loaded</div>}
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
          zIndex: (shape.props.pinned ?? false) ? 1000 : 100,
        }}
      >
        <TamboShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  // Indicator for selection, hover, etc.
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
