import { Tldraw, HTMLContainer, RecordProps, T, Editor, BaseBoxShapeUtil, TLBaseShape } from 'tldraw';
import 'tldraw/tldraw.css';
import { ReactNode, useRef, useEffect, createContext, useContext } from 'react';

// Create context for component store
const ComponentStoreContext = createContext<Map<string, ReactNode> | null>(null);

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
      <HTMLContainer
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
      </HTMLContainer>
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

export function TldrawCanvas({ onMount, shapeUtils, componentStore, ...rest }: TldrawCanvasProps) {
  return (
    <ComponentStoreContext.Provider value={componentStore || null}>
      <div style={{ position: 'fixed', inset: 0 }}>
        <Tldraw
          onMount={onMount}
          shapeUtils={shapeUtils || []}
          {...rest}
        />
      </div>
    </ComponentStoreContext.Provider>
  );
}
