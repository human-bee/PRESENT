import { Tldraw, ShapeUtil, HTMLContainer, RecordProps, Geometry2d, T, Rectangle2d, Editor, BaseBoxShapeUtil, useEditor, TLBaseShape } from 'tldraw';
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

// Define the TamboShapeUtil class
export class TamboShapeUtil extends BaseBoxShapeUtil<TamboShape> { // Extend BaseBoxShapeUtil for convenience
  static override type = "tambo" as const;
  static override props = {
    w: T.number,
    h: T.number,
    tamboComponent: T.any, // Using T.any for ReactNode as there's no direct Tldraw type for it
    name: T.string,
  } satisfies RecordProps<TamboShape>;

  // Provide default props for the Tambo shape
  override getDefaultProps(): TamboShape['props'] {
    return {
      w: 300, // Default width
      h: 200, // Default height
      tamboComponent: "",
      name: "Tambo Component"
    };
  }

  // Render method for the shape
  override component(shape: TamboShape) {
    const contentRef = useRef<HTMLDivElement>(null);
    // It's generally preferred to use the useEditor hook if inside a component context
    // that tldraw provides, or ensure `this.editor` is correctly bound and available.
    // For ShapeUtil methods, `this.editor` is the standard way.
    const editor = this.editor;
    const componentStore = useContext(ComponentStoreContext);

    useEffect(() => {
      const element = contentRef.current;
      if (!element || !editor) return;

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
              editor.updateShapes<TamboShape>([
                { id: shape.id, type: 'tambo', props: { w: newWidth, h: newHeight } },
              ]);
            }, 150); // Debounce for 150ms
          }
        }
      });

      observer.observe(element);

      return () => {
        clearTimeout(debounceTimer);
        observer.disconnect();
      };
    }, [shape.id, shape.props.w, shape.props.h, editor]); // Dependencies for the effect

    return (
      <HTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'center', // This will center the ref'd div if it's smaller
          justifyContent: 'center', // This will center the ref'd div if it's smaller
          overflow: 'hidden',
          // backgroundColor: 'rgba(0,0,255,0.1)', // For debugging visual bounds
        }}
      >
        <div
          style={{
            pointerEvents: 'all',
            width: '100%', // The HTMLContainer will be sized by shape.props.w/h
            height: '100%', // This inner div will fill the HTMLContainer
            display: 'flex', // To allow contentRef to dictate its own size if smaller
            alignItems: 'flex-start', // Align content to top-left of this div
            justifyContent: 'flex-start', // Align content to top-left of this div
          }}
        >
          <div ref={contentRef} style={{
            minWidth: '1px',
            minHeight: '1px',
            // maxWidth: '100%', // If content shouldn't overflow this wrapper
            // maxHeight: '100%',
            // overflow: 'auto', // If content can be larger and scrollable
            display: 'inline-block', // To make the div wrap its content's size
          }}>
            {shape.props.tamboComponent && componentStore ? 
              componentStore.get(shape.props.tamboComponent) || <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>Component not found</div>
              : <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>No component loaded</div>}
          </div>
        </div>
      </HTMLContainer>
    );
  }

  // Indicator for selection, hover, etc.
  override indicator(shape: TamboShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }
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
          shapeUtils={shapeUtils || []} // Pass custom shape utils
          {...rest}
        />
      </div>
    </ComponentStoreContext.Provider>
  );
}
