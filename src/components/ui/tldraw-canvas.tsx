import { Tldraw, ShapeUtil, HTMLContainer, RecordProps, Geometry2d, T, TLShapeMarkup, Rectangle2d, Editor, BaseBoxShapeUtil } from 'tldraw';
import 'tldraw/tldraw.css';
import { ReactNode } from 'react';

// Define the props for the Tambo shape - using serializable data instead of React components
export interface TamboShapeProps {
  w: number;
  h: number;
  // Store component data instead of React components to avoid clone errors
  componentData: {
    type: string;
    props: Record<string, any>;
    messageId: string;
  } | null;
  name: string;
}

// Create a type for the Tambo shape
export type TamboShape = T.Shape<"tambo", TamboShapeProps>;

// Store React components externally to avoid cloning issues
const componentRegistry = new Map<string, ReactNode>();

// Helper functions to manage the component registry
export const registerComponent = (messageId: string, component: ReactNode) => {
  componentRegistry.set(messageId, component);
};

export const getComponent = (messageId: string): ReactNode | null => {
  return componentRegistry.get(messageId) || null;
};

export const unregisterComponent = (messageId: string) => {
  componentRegistry.delete(messageId);
};

// Define the TamboShapeUtil class
export class TamboShapeUtil extends BaseBoxShapeUtil<TamboShape> { // Extend BaseBoxShapeUtil for convenience
  static override type = "tambo" as const;
  static override props = {
    w: T.number,
    h: T.number,
    // Store serializable component data instead of React components
    componentData: T.nullable(T.object({
      type: T.string,
      props: T.object({}),
      messageId: T.string,
    })),
    name: T.string,
  } satisfies RecordProps<TamboShape>;

  // Provide default props for the Tambo shape
  override getDefaultProps(): TamboShape['props'] {
    return {
      w: 300, // Default width
      h: 200, // Default height
      componentData: null,
      name: "Tambo Component"
    };
  }

  // Render method for the shape
  override component(shape: TamboShape): TLShapeMarkup {
    // Get the React component from the registry using the messageId
    const component = shape.props.componentData 
      ? getComponent(shape.props.componentData.messageId)
      : null;

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
        {component ? component : <div style={{padding: '10px', color: 'var(--color-text-muted)'}}>No component loaded</div>}
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
