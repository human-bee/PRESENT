"use client";

import React, {
  Component,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  ErrorInfo,
} from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@tldraw/tldraw';
import { getComponentSizeInfo } from '@/lib/component-sizing';
import { ComponentStoreContext } from '../hooks/useCanvasStore';
import type { CustomShape } from '../utils/shapeUtils';
import { useContextKey } from '@/components/RoomScopedProviders';
import { clearLocalPin, getLocalPin, type LocalPinData } from '../../utils/local-pin-store';

export class ComponentErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Component render error:', error, info);
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export function CustomShapeComponent({ shape }: { shape: CustomShape }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleWrapperRef = useRef<HTMLDivElement>(null);
  const contentInnerRef = useRef<HTMLDivElement>(null);
  const rehydrateRequestRef = useRef<string | null>(null);
  const componentStore = useContext(ComponentStoreContext);
  const editor = useEditor();
  const [, setRenderTick] = useState(0);
  const roomName = useContextKey() || 'canvas';
  const [localPin, setLocalPinState] = useState<LocalPinData | null>(null);

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const autoFittedRef = useRef(false);
  const lastMeasuredSizeRef = useRef<{ w: number; h: number } | null>(null);

  const sizeInfo = getComponentSizeInfo(shape.props.name);
  const sizingPolicy = sizeInfo.sizingPolicy || 'fit_until_user_resize';

  useEffect(() => {
    if (sizingPolicy === 'scale_only') return;
    const el = contentInnerRef.current;
    if (!el) return;

    let frame: number | null = null;

    const measure = () => {
      // Use layout metrics that are stable under CSS transforms so we do not chase our own scaling
      const widthCandidate = Math.max(el.scrollWidth, el.offsetWidth, el.clientWidth);
      const heightCandidate = Math.max(el.scrollHeight, el.offsetHeight, el.clientHeight);
      const w = Math.ceil(Number.isFinite(widthCandidate) ? widthCandidate : 0);
      const h = Math.ceil(Number.isFinite(heightCandidate) ? heightCandidate : 0);
      const prev = lastMeasuredSizeRef.current;
      if (!prev || Math.abs(prev.w - w) > 1 || Math.abs(prev.h - h) > 1) {
        lastMeasuredSizeRef.current = { w, h };
        setNaturalSize({ w, h });
      }
    };

    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });

    observer.observe(el);
    frame = requestAnimationFrame(measure);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [sizingPolicy]);

  useEffect(() => {
    lastMeasuredSizeRef.current = null;
    setNaturalSize(null);
  }, [shape.props.customComponent]);

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

  useEffect(() => {
    if (typeof window === 'undefined' || !componentStore) return;
    const messageId = String(shape.props.customComponent || '').trim();
    if (!messageId) return;

    const requestKey = `${shape.id}:${messageId}`;
    if (componentStore.has(messageId)) {
      if (rehydrateRequestRef.current === requestKey) {
        rehydrateRequestRef.current = null;
      }
      return;
    }
    if (rehydrateRequestRef.current === requestKey) {
      return;
    }
    rehydrateRequestRef.current = requestKey;
    try {
      window.dispatchEvent(
        new CustomEvent('custom:rehydrateComponents', {
          detail: {
            force: true,
            reason: 'shape_component_missing',
            messageId,
          },
        }),
      );
    } catch {
      // ignore dispatch failures in non-browser test contexts
    }
  }, [componentStore, shape.id, shape.props.customComponent, shape.props.name, shape.props.state]);

  useEffect(() => {
    autoFittedRef.current = false;
  }, [shape.props.name]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const read = () => {
      setLocalPinState(getLocalPin(roomName, String(shape.id)));
    };
    read();
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<any>).detail;
      if (!detail) return;
      if (detail.roomName && String(detail.roomName) !== roomName) return;
      if (detail.shapeId && String(detail.shapeId) !== String(shape.id)) return;
      read();
    };
    window.addEventListener('present:pins-changed', handler as EventListener);
    return () => {
      window.removeEventListener('present:pins-changed', handler as EventListener);
    };
  }, [roomName, shape.id]);

  useEffect(() => {
    if (!editor || !naturalSize) return;
    const unsafeEditor = editor as any;

    const policy = sizingPolicy;
    const userHasResized = Boolean(shape.props.userResized);

    const shouldAutoFit =
      policy === 'always_fit' || (policy === 'fit_until_user_resize' && !userHasResized);

    if (shouldAutoFit) {
      const { h: rawH } = naturalSize;
      // Guard: some components can transiently report 0 during first layout
      const minH = Math.max(32, sizeInfo.minHeight * 0.5);
      if (!Number.isFinite(rawH) || rawH < minH) {
        return;
      }
      // Width: always use design width from sizeInfo (components have fixed design widths)
      // Height: use measured height for dynamic content
      const nw = sizeInfo.naturalWidth;
      const nh = rawH;
      const widthChanged = Math.abs(shape.props.w - nw) > 1;
      const heightChanged = Math.abs(shape.props.h - nh) > 1;
      const allowMultiple = policy === 'always_fit';
      if ((widthChanged || heightChanged) && (allowMultiple || !autoFittedRef.current)) {
        unsafeEditor.updateShapes?.([
          { id: shape.id as any, type: 'custom', props: { w: nw, h: nh } },
        ]);
        if (!allowMultiple) autoFittedRef.current = true;
      }
    }
  }, [editor, naturalSize, shape.id, shape.props.name, shape.props.userResized, shape.props.w, shape.props.h, sizingPolicy, sizeInfo.naturalWidth, sizeInfo.minHeight]);

  // For width: Always use the component's design width to avoid feedback loops
  // (components like DebateScorecard have fixed widths like w-[1200px])
  // For height: Use measured height for dynamic content, or natural height for scale_only
  const baseW = sizeInfo.naturalWidth;
  const baseH = sizingPolicy === 'scale_only' ? sizeInfo.naturalHeight : (naturalSize?.h ?? sizeInfo.naturalHeight);

  const scaleX = shape.props.w / baseW;
  const scaleY = shape.props.h / baseH;
  const scale = Math.min(scaleX, scaleY);

  const scaledWidth = baseW * scale;
  const scaledHeight = baseH * scale;
  const offsetX = (shape.props.w - scaledWidth) / 2;
  const offsetY = (shape.props.h - scaledHeight) / 2;

  const content = (
    <div
      ref={containerRef}
      style={{
        width: `${shape.props.w}px`,
        height: `${shape.props.h}px`,
        overflow: 'hidden',
        position: 'relative',
        background: 'transparent',
        pointerEvents: 'all',
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest('button') ||
          target.closest('input') ||
          target.closest('select') ||
          target.closest('textarea') ||
          target.closest('[draggable="true"]')
        ) {
          event.stopPropagation();
        }
      }}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('input') || target.closest('select') || target.closest('textarea')) {
          event.stopPropagation();
        }
      }}
    >
      <div
        ref={scaleWrapperRef}
        style={{
          position: 'absolute',
          left: `${offsetX}px`,
          top: `${offsetY}px`,
          width: `${baseW}px`,
          height: `${baseH}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {/* Ensure percentage-based layouts (w-full, aspect-ratio padding) have a stable containing box. */}
        <div
          ref={contentInnerRef}
          style={{ width: `${baseW}px`, height: `${baseH}px`, display: 'block' }}
        >
          <ComponentErrorBoundary
            fallback={<div style={{ padding: 10, color: 'var(--color-text-muted)' }}>Component error</div>}
          >
            {shape.props.customComponent && componentStore ? (
              renderStoredComponent({
                shapeId: shape.id,
                shapeProps: shape.props,
                componentStore,
                editor,
              })
            ) : (
              <div style={{ padding: 10, color: 'var(--color-text-muted)' }}>No component loaded</div>
            )}
          </ComponentErrorBoundary>
        </div>
      </div>
    </div>
  );

  if (localPin && typeof document !== 'undefined') {
    const left = `${localPin.pinnedX * 100}vw`;
    const top = `${localPin.pinnedY * 100}vh`;
    const portal = createPortal(
      <div
        style={{
          position: 'fixed',
          left,
          top,
          transform: 'translate(-50%, -50%)',
          zIndex: 1100,
          pointerEvents: 'auto',
        }}
      >
        <div className="absolute -top-9 right-0 flex items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-white shadow-sm"
            onClick={() => {
              clearLocalPin(roomName, String(shape.id));
              setLocalPinState(null);
            }}
          >
            Unpin
          </button>
        </div>
        {content}
      </div>,
      document.body,
    );

    // Keep a lightweight placeholder in the canvas so the shape can still be selected/unpinned.
    return (
      <>
        <div
          style={{
            width: `${shape.props.w}px`,
            height: `${shape.props.h}px`,
            position: 'relative',
            overflow: 'hidden',
            background: 'transparent',
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-400">
            Pinned
          </div>
        </div>
        {portal}
      </>
    );
  }

  return content;
}

interface RenderStoredComponentArgs {
  shapeId: CustomShape['id'];
  shapeProps: CustomShape['props'];
  componentStore: Map<string, ReactNode> | null;
  editor: ReturnType<typeof useEditor>;
}

function renderStoredComponent({ shapeId, shapeProps, componentStore, editor }: RenderStoredComponentArgs) {
  const stored = componentStore?.get(shapeProps.customComponent);
  let node: ReactNode = null;

  const updateState = (patch: Record<string, unknown> | ((prev: any) => any)) => {
    if (!editor) return;
    const unsafeEditor = editor as any;
    const prevState = (shapeProps.state as Record<string, unknown>) || {};
    const nextState = typeof patch === 'function' ? (patch as any)(prevState) : { ...prevState, ...patch };
    unsafeEditor.updateShapes?.([
      {
        id: shapeId as any,
        type: 'custom',
        props: { state: nextState },
      },
    ]);
  };

  const injectedBase = {
    __custom_message_id: shapeProps.customComponent,
    state: (shapeProps.state as Record<string, unknown>) || {},
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
    ((stored as any).type || (stored as any).Component || (stored as any).component)
  ) {
    const type = (stored as any).type || (stored as any).Component || (stored as any).component;
    const shouldInjectUpdateState = typeof type !== 'string';
    const props = {
      ...((stored as any).props || {}),
      ...injectedBase,
      ...(shouldInjectUpdateState ? { updateState } : {}),
    };
    if (!shouldInjectUpdateState) {
      delete (props as any).updateState;
    }
    try {
      node = React.createElement(type, props);
    } catch {
      /* noop */
    }
  }

  if (node) return node;

  return <div style={{ padding: 10, color: 'var(--color-text-muted)' }}>Component not found</div>;
}
