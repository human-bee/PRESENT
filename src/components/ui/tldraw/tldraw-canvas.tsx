'use client';

import {
  Tldraw,
  HTMLContainer as TldrawHTMLContainer,
  RecordProps,
  T,
  Editor,
  BaseBoxShapeUtil,
  TLBaseShape,
  createShapeId,
  useEditor,
} from 'tldraw';
import {
  ReactNode,
  useRef,
  useEffect,
  createContext,
  useContext,
  Component,
  ErrorInfo,
  useState,
} from 'react';
import React from 'react';
import { CanvasSyncAdapter } from '@/components/CanvasSyncAdapter';
import { nanoid } from 'nanoid';
// 1. Import ComponentToolbox
import { ComponentToolbox } from '@/components/ui/shared/component-toolbox';
import { getComponentSizeInfo } from '@/lib/component-sizing';
import { TLResizeInfo } from 'tldraw';
import MermaidStreamRenderer, { MermaidCompileState } from '@/components/ui/mermaid-stream-renderer';

// Create context for component store
export const ComponentStoreContext = createContext<Map<string, ReactNode> | null>(null);

// Create context for editor instance
export const EditorContext = createContext<Editor | null>(null);

// Define the props for the custom shape
export interface customShapeProps {
  w: number;
  h: number;
  customComponent: string; // Store message ID instead of ReactNode to avoid cloning issues
  name: string;
  pinned?: boolean; // Whether the shape is pinned to viewport
  pinnedX?: number; // Relative X position (0-1) when pinned
  pinnedY?: number; // Relative Y position (0-1) when pinned
  // Persist whether a user explicitly resized this shape so auto-fit can stop
  userResized?: boolean;
  // Serializable component state that syncs via TLDraw and persists in Supabase
  state?: Record<string, unknown>;
}

// Create a type for the custom shape
export type customShape = TLBaseShape<'custom', customShapeProps>;

// Mermaid stream shape
export interface MermaidStreamShapeProps {
  w: number;
  h: number;
  name: string;
  mermaidText: string;
  compileState: 'idle' | 'compiling' | 'ok' | 'error';
  streamId?: string;
  keepLastGood?: boolean;
}

export type MermaidStreamShape = TLBaseShape<'mermaid_stream', MermaidStreamShapeProps>;

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
function CustomShapeComponent({ shape }: { shape: customShape }) {
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

  // Reset one-time autofit guard when the component type changes
  useEffect(() => {
    autoFittedRef.current = false;
  }, [shape.props.name]);

  // Conditional auto-fit based on sizingPolicy and whether user resized
  useEffect(() => {
    if (!editor || !naturalSize) return;

    const sizeInfo = getComponentSizeInfo(shape.props.name);
    const policy = sizeInfo.sizingPolicy || 'fit_until_user_resize';

    // Respect explicit user resize persisted on the shape
    const userHasResized = Boolean((shape.props as any).userResized);

    const shouldAutoFit =
      policy === 'always_fit' || (policy === 'fit_until_user_resize' && !userHasResized);

    if (shouldAutoFit) {
      const { w: nw, h: nh } = naturalSize;
      const changed = Math.abs(shape.props.w - nw) > 1 || Math.abs(shape.props.h - nh) > 1;
      // Apply only once for fit_until_user_resize to avoid resize loops from dynamic content
      const allowMultiple = policy === 'always_fit';
      if (changed && (allowMultiple || !autoFittedRef.current)) {
        editor.updateShapes([
          { id: shape.id, type: 'custom', props: { ...shape.props, w: nw, h: nh } },
        ]);
        if (!allowMultiple) autoFittedRef.current = true;
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
        <div
          ref={contentInnerRef}
          style={{ width: 'auto', height: 'auto', display: 'inline-block' }}
        >
          <ComponentErrorBoundary
            fallback={
              <div style={{ padding: '10px', color: 'var(--color-text-muted)' }}>
                Component error
              </div>
            }
          >
            {shape.props.customComponent && componentStore ? (
              (() => {
                const stored = componentStore.get(shape.props.customComponent) as any;
                let node: React.ReactNode = null;
                const updateState = (patch: Record<string, unknown> | ((prev: any) => any)) => {
                  if (!editor) return;
                  const prevState = (shape.props.state as Record<string, unknown>) || {};
                  const nextState =
                    typeof patch === 'function' ? (patch as any)(prevState) : { ...prevState, ...patch };
                  editor.updateShapes([
                    {
                      id: shape.id,
                      type: 'custom',
                      props: { state: nextState },
                    },
                  ]);
                };
                const injectedBase = {
                  __custom_message_id: shape.props.customComponent,
                  state: (shape.props.state as Record<string, unknown>) || {},
                } as const;
                if (React.isValidElement(stored)) {
                  const elementType = stored.type as any;
                  const shouldInjectUpdateState = typeof elementType !== 'string';
                  const nextProps = {
                    ...(stored.props || {}),
                    ...injectedBase,
                    ...(shouldInjectUpdateState ? { updateState } : {}),
                  } as Record<string, unknown>;
                  if (!shouldInjectUpdateState) {
                    delete (nextProps as any).updateState;
                  }
                  try {
                    node = React.cloneElement(stored, nextProps as any);
                  } catch {
                    node = stored;
                  }
                } else if (
                  stored &&
                  typeof stored === 'object' &&
                  (stored.type || stored.Component || stored.component)
                ) {
                  // Try to reconstruct from { type, props }
                  const type = stored.type || stored.Component || stored.component;
                  const shouldInjectUpdateState = typeof type !== 'string';
                  const props = {
                    ...(stored.props || {}),
                    ...injectedBase,
                    ...(shouldInjectUpdateState ? { updateState } : {}),
                  };
                  if (!shouldInjectUpdateState) {
                    delete (props as any).updateState;
                  }
                  try {
                    node = React.createElement(type, props);
                  } catch {
                    // fall through
                  }
                }
                return (
                  node || (
                    <div style={{ padding: '10px', color: 'var(--color-text-muted)' }}>
                      Component not found
                    </div>
                  )
                );
              })()
            ) : (
              <div style={{ padding: '10px', color: 'var(--color-text-muted)' }}>
                No component loaded
              </div>
            )}
          </ComponentErrorBoundary>
        </div>
      </div>
    </div>
  );
}

// Mermaid stream shape component wrapper
function MermaidStreamShapeComponent({ shape }: { shape: MermaidStreamShape }) {
  const editor = useEditor();
  const [isEditing, setIsEditing] = useState(false);
  const [localText, setLocalText] = useState<string>(String(shape.props.mermaidText || ''));
  const [isStreaming, setIsStreaming] = useState(false);
  const lastMeasuredRef = useRef<{ w: number; h: number } | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalText(String(shape.props.mermaidText || ''));
  }, [shape.props.mermaidText]);

  const handleState = React.useCallback(
    (state: MermaidCompileState, info?: { ms?: number; error?: string }) => {
      try {
        editor.updateShapes([
          {
            id: shape.id,
            type: 'mermaid_stream' as const,
            props: { compileState: state },
          } as any,
        ]);
        if (process.env.NODE_ENV === 'development') {
          if (state === 'ok' && info?.ms) console.debug('[Mermaid] compiled in', info.ms, 'ms');
          if (state === 'error' && info?.error) console.debug('[Mermaid] error', info.error);
        }
      } catch {}
    },
    [editor, shape.id],
  );

  const handleFit = React.useCallback(
    (size: { w: number; h: number }) => {
      lastMeasuredRef.current = size;
      const dw = Math.abs((shape.props.w || 0) - size.w);
      const dh = Math.abs((shape.props.h || 0) - size.h);
      if (dw < 2 && dh < 2) return;
      try {
        editor.updateShapes([
          { id: shape.id, type: 'mermaid_stream' as const, props: { w: size.w, h: size.h } } as any,
        ]);
      } catch {}
    },
    [editor, shape.id, shape.props.w, shape.props.h],
  );

  // Auto-fit on first successful compile if size is known
  useEffect(() => {
    if (shape.props.compileState === 'ok' && lastMeasuredRef.current) {
      const size = lastMeasuredRef.current;
      const dw = Math.abs((shape.props.w || 0) - size.w);
      const dh = Math.abs((shape.props.h || 0) - size.h);
      if (dw > 2 || dh > 2) {
        try {
          editor.updateShapes([
            { id: shape.id, type: 'mermaid_stream' as const, props: { w: size.w, h: size.h } } as any,
          ]);
        } catch {}
      }
    }
  }, [editor, shape.id, shape.props.compileState]);

  const applyText = React.useCallback(
    (text: string) => {
      try {
        editor.updateShapes([
          { id: shape.id, type: 'mermaid_stream' as const, props: { mermaidText: text } } as any,
        ]);
        // Broadcast to peers via custom event handled in collaboration wrapper
        try {
          window.dispatchEvent(
            new CustomEvent('custom:shapePatch', {
              detail: { shapeId: shape.id, patch: { mermaidText: text } },
            }),
          );
        } catch {}
      } catch {}
    },
    [editor, shape.id],
  );

  const toggleStream = React.useCallback(() => {
    if (isStreaming) {
      setIsStreaming(false);
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
      return;
    }
    setIsStreaming(true);
    const chunks = [
      'graph TD;',
      ' A[Start] --> B{Decision};',
      ' B -->|Yes| C[OK];',
      ' B -->|No| D[Retry];',
      ' D --> A;'
    ];
    let i = 0;
    const seed = '';
    applyText(seed);
    streamTimerRef.current = setInterval(() => {
      if (i >= chunks.length) {
        if (streamTimerRef.current) clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
        setIsStreaming(false);
        return;
      }
      const next = (localText ? '' : '') + chunks.slice(0, i + 1).join('');
      applyText(next);
      i += 1;
    }, 250);
  }, [applyText, isStreaming, localText]);

  useEffect(() => {
    return () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    };
  }, []);

  return (
    <div style={{ width: shape.props.w, height: shape.props.h, position: 'relative' }}>
      <MermaidStreamRenderer
        mermaidText={String(shape.props.mermaidText || '')}
        keepLastGood={shape.props.keepLastGood !== false}
        onCompileStateChange={handleState}
        onFitMeasured={handleFit}
      />
      {/* Inline controls overlay */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          display: 'flex',
          gap: 6,
          background: 'rgba(255,255,255,0.8)',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 8,
          padding: '4px 6px',
        }}
      >
        <button
          onClick={() => setIsEditing((v) => !v)}
          title={isEditing ? 'Close editor' : 'Edit inline'}
          className="tlui-button tlui-button__tool"
          style={{ fontSize: 12 }}
        >
          {isEditing ? 'Close' : 'Edit'}
        </button>
        <button
          onClick={() => {
            const size = lastMeasuredRef.current;
            if (size) {
              try {
                editor.updateShapes([
                  { id: shape.id, type: 'mermaid_stream' as const, props: { w: size.w, h: size.h } } as any,
                ]);
              } catch {}
            }
          }}
          title="Fit to content"
          className="tlui-button tlui-button__tool"
          style={{ fontSize: 12 }}
        >
          Fit
        </button>
        <button
          onClick={() => {
            try { navigator.clipboard?.writeText(String(shape.props.mermaidText || '')); } catch {}
          }}
          title="Copy Mermaid"
          className="tlui-button tlui-button__tool"
          style={{ fontSize: 12 }}
        >
          Copy
        </button>
        <button
          onClick={() => {
            try {
              editor.updateShapes([
                { id: shape.id, type: 'mermaid_stream' as const, props: { keepLastGood: !(shape.props.keepLastGood !== false) } } as any,
              ]);
            } catch {}
          }}
          title="Toggle keep last valid render"
          className="tlui-button tlui-button__tool"
          style={{ fontSize: 12 }}
        >
          {shape.props.keepLastGood !== false ? 'Keep✓' : 'Keep✗'}
        </button>
        <button
          onClick={toggleStream}
          title="Start/Stop stream"
          className="tlui-button tlui-button__tool"
          style={{ fontSize: 12 }}
        >
          {isStreaming ? 'Stop' : 'Stream'}
        </button>
      </div>

      {isEditing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255,255,255,0.9)',
            display: 'flex',
            flexDirection: 'column',
            padding: 8,
            gap: 6,
          }}
        >
          <textarea
            value={localText}
            onChange={(e) => {
              const v = e.target.value;
              setLocalText(v);
              if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
              editDebounceRef.current = setTimeout(() => applyText(v), 150);
            }}
            style={{ flex: 1, width: '100%', resize: 'none', fontFamily: 'monospace', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              className="tlui-button tlui-button__tool"
              onClick={() => {
                applyText(localText);
                setIsEditing(false);
              }}
              style={{ fontSize: 12 }}
            >
              Apply
            </button>
            <button
              className="tlui-button tlui-button__tool"
              onClick={() => setIsEditing(false)}
              style={{ fontSize: 12 }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export class MermaidStreamShapeUtil extends BaseBoxShapeUtil<MermaidStreamShape> {
  static override type = 'mermaid_stream' as const;
  static override props = {
    w: T.number,
    h: T.number,
    name: T.string,
    mermaidText: T.string,
    compileState: T.optional(T.string),
    // Back-compat: accept legacy saved shapes that used renderState to avoid rehydrate crashes
    renderState: T.optional(T.string),
    streamId: T.optional(T.string),
    keepLastGood: T.optional(T.boolean),
  } satisfies RecordProps<MermaidStreamShape>;

  override getDefaultProps(): MermaidStreamShape['props'] {
    return {
      w: 400,
      h: 300,
      name: 'Mermaid (stream)',
      mermaidText: 'graph TD; A[Start] --> B{Decision}; B -->|Yes| C[OK]; B -->|No| D[Retry];',
      compileState: 'idle',
      keepLastGood: true,
    };
  }

  override component(shape: MermaidStreamShape) {
    return (
      <TldrawHTMLContainer
        id={shape.id}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'stretch',
          overflow: 'hidden',
          pointerEvents: 'all',
          position: 'relative',
          width: shape.props.w + 'px',
          height: shape.props.h + 'px',
        }}
      >
        <MermaidStreamShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  override indicator(shape: MermaidStreamShape) {
    return <rect width={shape.props.w} height={shape.props.h} fill="transparent" />;
  }

  override canEdit = () => false;
  override canResize = () => true;
  override isAspectRatioLocked = () => false;
}

// Define the customShapeUtil class
export class customShapeUtil extends BaseBoxShapeUtil<customShape> {
  static override type = 'custom' as const;
  static override props = {
    w: T.number,
    h: T.number,
    customComponent: T.any,
    name: T.string,
    pinned: T.optional(T.boolean),
    pinnedX: T.optional(T.number),
    pinnedY: T.optional(T.number),
    userResized: T.optional(T.boolean),
    state: T.optional(T.any),
  } satisfies RecordProps<customShape>;

  // Track shapes the user has explicitly resized
  private userResized = new Set<string>();

  // Provide default props for the custom shape
  override getDefaultProps(): customShape['props'] {
    return {
      w: 300,
      h: 200,
      customComponent: '',
      name: 'custom Component',
      pinned: false,
      pinnedX: 0.5,
      pinnedY: 0.5,
      userResized: false,
    };
  }

  // Render method for the shape
  override component(shape: customShape) {
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
        <CustomShapeComponent shape={shape} />
      </TldrawHTMLContainer>
    );
  }

  // Override indicator for selection, hover, etc.
  override indicator(shape: customShape) {
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
    return fromShapeType !== 'custom';
  };

  // Handle TLDraw-initiated resizes with component constraints
  override onResize = (shape: customShape, info: TLResizeInfo<customShape>) => {
    // Mark that the user has explicitly resized this shape
    this.userResized.add(shape.id);

    const componentName = shape.props.name; // Component type from name
    const sizeInfo = getComponentSizeInfo(componentName);

    if (process.env.NODE_ENV === 'development' && (window as any)?.__PRESENT_VERBOSE__) {
      console.log(`🔧 [customShapeUtil] Resizing ${componentName}:`, {
        scaleX: info.scaleX,
        scaleY: info.scaleY,
        originalSize: { w: shape.props.w, h: shape.props.h },
      });
    }

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
        h,
        userResized: true,
      },
    };
  };

  // Provide a lightweight SVG for thumbnails so we don't render HTML fallbacks
  override toSvg(shape: customShape, _ctx: any) {
    const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    // Try to capture the live HTML from the on-canvas container
    const container = typeof document !== 'undefined' ? document.getElementById(shape.id) : null;
    const inner = container?.innerHTML ?? '';

    const backgroundRect = (
      <rect
        x={0}
        y={0}
        width={shape.props.w}
        height={shape.props.h}
        rx={8}
        ry={8}
        fill="white"
        stroke="#E5E7EB"
        strokeWidth={1}
      />
    );

    if (!inner) {
      // Fallback minimal label when the DOM isn't available yet
      return (
        <>
          {backgroundRect}
          <text
            x={shape.props.w / 2}
            y={shape.props.h / 2}
            dominantBaseline="middle"
            textAnchor="middle"
            fill="#64748B"
            fontSize={12}
            fontFamily="ui-sans-serif, system-ui, -apple-system"
          >
            {shape.props.name || 'Component'}
          </text>
        </>
      );
    }

    // Wrap HTML content inside a foreignObject to embed real DOM in SVG
    return (
      <>
        {backgroundRect}
        <foreignObject
          x={0}
          y={0}
          width={shape.props.w}
          height={shape.props.h}
          className="tl-export-embed-styles"
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              overflow: 'hidden',
              background: 'transparent',
              fontFamily: 'ui-sans-serif, system-ui, -apple-system',
            }}
            dangerouslySetInnerHTML={{ __html: inner }}
          />
        </foreignObject>
      </>
    );
  }

  // Expose a method for the component renderer to query if user resized
  public hasUserResized(id: string) {
    return this.userResized.has(id);
  }
}

// Component wrapper for Toolbox inside shape
function ToolboxShapeComponent({ shape }: { shape: TLBaseShape<'toolbox', { w: number; h: number; name: string }> }) {
  // Use TLDraw's built-in hook to get the editor instead of context
  const editor = useEditor();
  const componentStore = useContext(ComponentStoreContext);

  const handleComponentCreate = (componentType: string) => {
    console.log('🔧 Creating component from toolbox:', componentType);

    if (!editor || !componentStore) {
      console.error('Editor or component store not available', {
        editor: !!editor,
        componentStore: !!componentStore,
      });
      return;
    }

    // Import components from custom
    const { components } = require('@/lib/custom');
    const Component = components.find((c: any) => c.name === componentType)?.component;
    if (!Component) {
      console.error('Component not found:', componentType);
      return;
    }

    const shapeId = createShapeId(nanoid());
    const componentInstance = React.createElement(Component, { __custom_message_id: shapeId });
    componentStore.set(shapeId, componentInstance);

    const viewport = editor.getViewportPageBounds();
    const x = viewport ? viewport.midX - 150 : 0;
    const y = viewport ? viewport.midY - 100 : 0;

    editor.createShape({
      id: shapeId,
      type: 'custom',
      x,
      y,
      props: {
        w: 300,
        h: 200,
        customComponent: shapeId,
        name: componentType,
      },
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
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ComponentToolbox onComponentCreate={handleComponentCreate} />
    </div>
  );
}

// 2. Add ToolboxShapeUtil
export class ToolboxShapeUtil extends BaseBoxShapeUtil<TLBaseShape<'toolbox', { w: number; h: number; name: string }>> {
  static override type = 'toolbox' as const;
  static override props = {
    w: T.number,
    h: T.number,
    name: T.string,
  } satisfies RecordProps<TLBaseShape<'toolbox', { w: number; h: number; name: string }>>;

  override getDefaultProps(): { w: number; h: number; name: string } {
    return {
      w: 56,
      h: 560,
      name: 'Component Toolbox',
    };
  }

  override component(shape: TLBaseShape<'toolbox', { w: number; h: number; name: string }>) {
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

  override indicator(shape: TLBaseShape<'toolbox', { w: number; h: number; name: string }>) {
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
  shapeUtils?: readonly (typeof customShapeUtil)[]; // Allow passing custom shape utils
  componentStore?: Map<string, ReactNode>; // Component store for custom shapes
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
    if (
      error.message.includes('ValidationError') ||
      error.message.includes('Expected a valid url') ||
      error.message.includes('shape(type = bookmark)')
    ) {
      console.warn(
        'Validation error suppressed - this is handled by custom external content handlers',
      );
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
            <p className="text-gray-500 mb-4">
              There was an issue with the canvas. Refreshing may help.
            </p>
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

export function TldrawCanvas({
  onMount,
  shapeUtils,
  componentStore,
  componentId: propId,
  ...rest
}: TldrawCanvasProps) {
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
    try {
      return ed.getCurrentPageShapes().length;
    } catch {
      return 0;
    }
  };

  if (!isClient) {
    return (
      <div
        style={{ position: 'fixed', inset: 0 }}
        className="flex items-center justify-center bg-gray-50"
      >
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
              <Tldraw onMount={handleMount} shapeUtils={shapeUtils || []} {...rest} />
            </div>
          </ComponentStoreContext.Provider>
        </EditorContext.Provider>
      </TldrawErrorBoundary>
    </CanvasSyncAdapter>
  );
}
