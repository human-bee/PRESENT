import { Tldraw, HTMLContainer as TldrawHTMLContainer, RecordProps, T, Editor, BaseBoxShapeUtil, TLBaseShape, TLExternalContentProps, TLExternalContentSource } from 'tldraw';
import { ReactNode, useRef, useEffect, createContext, useContext, Component, ErrorInfo } from 'react';

// Create context for component store
export const ComponentStoreContext = createContext<Map<string, ReactNode> | null>(null);

// Define the props for the Tambo shape
export interface TamboShapeProps {
  w: number;
  h: number;
  tamboComponent: string; // Store message ID instead of ReactNode to avoid cloning issues
  name: string;
}

// Create a type for the Tambo shape
export type TamboShape = TLBaseShape<"tambo", TamboShapeProps>;

// Component wrapper to handle hooks inside the shape
function TamboShapeComponent({ shape }: { shape: TamboShape }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const componentStore = useContext(ComponentStoreContext);

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
            console.log('Shape size changed:', newWidth, newHeight);
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
        zIndex: 1000, // High z-index to ensure interactions work
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
  } satisfies RecordProps<TamboShape>;

  // Provide default props for the Tambo shape
  override getDefaultProps(): TamboShape['props'] {
    return {
      w: 300,
      h: 200,
      tamboComponent: "",
      name: "Tambo Component"
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
          zIndex: 100,
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
}

export interface TldrawCanvasProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[]; // Allow passing custom shape utils
  componentStore?: Map<string, ReactNode>; // Component store for Tambo shapes
  // Add any other props you might need to pass to Tldraw component
}

// Custom external content handlers to fix image drop validation errors
const customExternalContentHandlers = {
  // Handle text content
  text: async ({ point, sources, editor }: TLExternalContentProps) => {
    const textContent = sources.find((source) => source.type === 'text')?.data;
    if (textContent) {
      editor.createShapes([
        {
          id: editor.createShapeId(),
          type: 'text',
          x: point.x,
          y: point.y,
          props: {
            text: textContent,
          },
        },
      ]);
    }
  },

  // Handle URL content - prevent bookmark creation with data URLs
  url: async ({ point, sources, editor }: TLExternalContentProps) => {
    const urlSource = sources.find((source) => source.type === 'url') as TLExternalContentSource & { type: 'url' };
    if (urlSource?.data) {
      const url = urlSource.data;
      
      // Skip data URLs to prevent validation errors
      if (url.startsWith('data:')) {
        console.warn('Skipping data URL for bookmark creation:', url.substring(0, 50) + '...');
        return;
      }
      
      // Only create bookmarks for valid HTTP/HTTPS URLs
      if (url.startsWith('http://') || url.startsWith('https://')) {
        editor.createShapes([
          {
            id: editor.createShapeId(),
            type: 'bookmark',
            x: point.x,
            y: point.y,
            props: {
              url: url,
            },
          },
        ]);
      }
    }
  },

  // Handle files including images
  files: async ({ point, sources, editor }: TLExternalContentProps) => {
    const fileSource = sources.find((source) => source.type === 'file') as TLExternalContentSource & { type: 'file' };
    if (fileSource?.data) {
      const file = fileSource.data;
      
      // Handle image files
      if (file.type.startsWith('image/')) {
        try {
          const reader = new FileReader();
          reader.onload = (e) => {
            const result = e.target?.result;
            if (typeof result === 'string') {
              // Create an image shape instead of a bookmark
              editor.createShapes([
                {
                  id: editor.createShapeId(),
                  type: 'image',
                  x: point.x,
                  y: point.y,
                  props: {
                    url: result, // data URL is valid for image shapes
                    w: 300,
                    h: 200,
                  },
                },
              ]);
            }
          };
          reader.readAsDataURL(file);
        } catch (error) {
          console.error('Error processing dropped image:', error);
        }
      }
    }
  },
};

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

export function TldrawCanvas({ onMount, shapeUtils, componentStore, ...rest }: TldrawCanvasProps) {
  return (
    <TldrawErrorBoundary>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <div style={{ position: 'fixed', inset: 0 }}>
          <Tldraw
            onMount={onMount}
            shapeUtils={shapeUtils || []}
            externalContentHandlers={customExternalContentHandlers}
            {...rest}
          />
        </div>
      </ComponentStoreContext.Provider>
    </TldrawErrorBoundary>
  );
}
