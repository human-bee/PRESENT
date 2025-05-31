import { Tldraw, ShapeUtil, HTMLContainer, RecordProps, Geometry2d, T, TLShapeMarkup, Rectangle2d, Editor, BaseBoxShapeUtil } from 'tldraw';
import 'tldraw/tldraw.css';
import { ReactNode } from 'react';

// Define the props for the Tambo shape
export interface TamboShapeProps {
  w: number;
  h: number;
  tamboComponent: ReactNode;
  name: string;
}

// Create a type for the Tambo shape
export type TamboShape = T.Shape<"tambo", TamboShapeProps>;

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
      tamboComponent: null,
      name: "Tambo Component"
    };
  }

  // Render method for the shape
  override component(shape: TamboShape): TLShapeMarkup {
    // Use HTMLContainer to embed React components or HTML
    return (
      <HTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'all', // Allow interaction with the component
          overflow: 'hidden', // Clip content to shape bounds
          border: '1px solid var(--color-border)', // Optional: visual border
          backgroundColor: 'var(--color-background)', // Optional: background
        }}
      >
        {shape.props.tamboComponent ? shape.props.tamboComponent : <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>No component loaded</div>}
      </HTMLContainer>
    );
  }

  // Indicator for selection, hover, etc.
  override indicator(shape: TamboShape): TLShapeMarkup {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }
}

export interface TldrawCanvasProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[]; // Allow passing custom shape utils
  // Add any other props you might need to pass to Tldraw component
}

export function TldrawCanvas({ onMount, shapeUtils, ...rest }: TldrawCanvasProps) {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        onMount={onMount}
        shapeUtils={shapeUtils || []} // Pass custom shape utils
        {...rest}
      />
    </div>
  );
}
