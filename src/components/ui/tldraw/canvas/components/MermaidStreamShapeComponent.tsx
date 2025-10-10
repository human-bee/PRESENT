"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '@tldraw/tldraw';
import MermaidStreamRenderer, { MermaidCompileState } from '@/components/ui/mermaid-stream-renderer';
import type { MermaidStreamShape } from '../utils/shapeUtils';

export function MermaidStreamShapeComponent({ shape }: { shape: MermaidStreamShape }) {
  const editor = useEditor();
  const [isEditing, setIsEditing] = useState(false);
  const [localText, setLocalText] = useState<string>(String(shape.props.mermaidText || ''));
  const [isStreaming, setIsStreaming] = useState(false);
  const lastMeasuredRef = useRef<{ w: number; h: number } | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackStateRef = useRef<{ message: string | null; triggeredAt: number }>({
    message: null,
    triggeredAt: 0,
  });
  const lastErrorEventRef = useRef<{ message: string | null; timestamp: number }>({
    message: null,
    timestamp: 0,
  });
  const isEditingRef = useRef(false);

  useEffect(() => {
    setLocalText(String(shape.props.mermaidText || ''));
  }, [shape.props.mermaidText]);

  const resolveRoomName = useCallback((): string | undefined => {
    if (typeof window === 'undefined') return undefined;
    const globalAny = window as any;
    const candidate: unknown =
      globalAny?.__present?.livekitRoomName ??
      globalAny?.__present_roomName ??
      globalAny?.__present_canvas_room;
    const name = typeof candidate === 'string' ? candidate.trim() : '';
    return name || undefined;
  }, []);

  const emitCanvasEvent = useCallback((eventName: string, detail: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch {
      // ignore dispatch errors
    }
  }, []);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const maybeTriggerFallback = useCallback(
    (errorMessage: string | null | undefined) => {
      if (typeof window === 'undefined') return;
      if (isEditingRef.current) return;
      const normalized =
        typeof errorMessage === 'string' && errorMessage.trim().length > 0
          ? errorMessage.trim()
          : 'Mermaid render failed';
      const now = Date.now();
      const last = fallbackStateRef.current;
      if (last.message === normalized && now - last.triggeredAt < 15000) {
        return;
      }
      fallbackStateRef.current = { message: normalized, triggeredAt: now };
      const roomName = resolveRoomName();
      const detail: Record<string, unknown> = {
        shapeId: shape.id,
        docId: shape.id,
        error: normalized,
      };
      if (roomName) detail.room = roomName;
      emitCanvasEvent('present:flowchart-fallback', detail);
    },
    [emitCanvasEvent, resolveRoomName, shape.id],
  );

  const handleState = useCallback(
    (state: MermaidCompileState, info?: { ms?: number; error?: string }) => {
      try {
        const unsafeEditor = editor as any;
        unsafeEditor?.updateShapes?.([
          {
            id: shape.id as any,
            type: 'mermaid_stream' as const,
            props: { compileState: state },
          } as any,
        ]);
        if (process.env.NODE_ENV === 'development') {
          if (state === 'ok' && info?.ms) console.debug('[Mermaid] compiled in', info.ms, 'ms');
          if (state === 'error' && info?.error) console.debug('[Mermaid] error', info.error);
        }
        if (state === 'error') {
          const normalized =
            typeof info?.error === 'string' && info.error.trim()
              ? info.error.trim()
              : 'Mermaid render failed';
          const now = Date.now();
          const lastEvent = lastErrorEventRef.current;
          if (lastEvent.message !== normalized || now - lastEvent.timestamp > 250) {
            lastErrorEventRef.current = { message: normalized, timestamp: now };
            const roomName = resolveRoomName();
            const detail: Record<string, unknown> = {
              shapeId: shape.id,
              docId: shape.id,
              error: normalized,
            };
            if (roomName) detail.room = roomName;
            emitCanvasEvent('present:mermaid-error', detail);
          }
          maybeTriggerFallback(normalized);
        } else if (state === 'ok') {
          lastErrorEventRef.current = { message: null, timestamp: Date.now() };
          fallbackStateRef.current = { message: null, triggeredAt: 0 };
          emitCanvasEvent('present:mermaid-ok', { shapeId: shape.id, docId: shape.id });
        }
      } catch {}
    },
    [editor, emitCanvasEvent, maybeTriggerFallback, resolveRoomName, shape.id],
  );

  const handleFit = useCallback(
    (size: { w: number; h: number }) => {
      lastMeasuredRef.current = size;
      const dw = Math.abs((shape.props.w || 0) - size.w);
      const dh = Math.abs((shape.props.h || 0) - size.h);
      if (dw < 2 && dh < 2) return;
      try {
        const unsafeEditor = editor as any;
        unsafeEditor?.updateShapes?.([
          { id: shape.id as any, type: 'mermaid_stream' as const, props: { w: size.w, h: size.h } } as any,
        ]);
      } catch {}
    },
    [editor, shape.id, shape.props.h, shape.props.w],
  );

  useEffect(() => {
    if (shape.props.compileState === 'ok' && lastMeasuredRef.current) {
      const size = lastMeasuredRef.current;
      const dw = Math.abs((shape.props.w || 0) - size.w);
      const dh = Math.abs((shape.props.h || 0) - size.h);
      if (dw > 2 || dh > 2) {
        try {
          const unsafeEditor = editor as any;
          unsafeEditor?.updateShapes?.([
            { id: shape.id as any, type: 'mermaid_stream' as const, props: { w: size.w, h: size.h } } as any,
          ]);
        } catch {}
      }
    }
  }, [editor, shape.id, shape.props.compileState, shape.props.h, shape.props.w]);

  const applyText = useCallback(
    (text: string) => {
      try {
        const unsafeEditor = editor as any;
        unsafeEditor?.updateShapes?.([
          { id: shape.id as any, type: 'mermaid_stream' as const, props: { mermaidText: text } } as any,
        ]);
        if (typeof window !== 'undefined') {
          try {
            window.dispatchEvent(
              new CustomEvent('custom:shapePatch', {
                detail: { shapeId: shape.id, patch: { mermaidText: text } },
              }),
            );
          } catch {}
        }
      } catch {}
    },
    [editor, shape.id],
  );

  const toggleStream = useCallback(() => {
    if (isStreaming) {
      setIsStreaming(false);
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
      return;
    }
    setIsStreaming(true);
    const chunks = ['graph TD;', ' A[Start] --> B{Decision};', ' B -->|Yes| C[OK];', ' B -->|No| D[Retry];', ' D --> A;'];
    let i = 0;
    applyText('');
    streamTimerRef.current = setInterval(() => {
      if (i >= chunks.length) {
        if (streamTimerRef.current) clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
        setIsStreaming(false);
        return;
      }
      const next = chunks.slice(0, i + 1).join('');
      applyText(next);
      i += 1;
    }, 250);
  }, [applyText, isStreaming]);

  useEffect(() => () => {
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    streamTimerRef.current = null;
  }, []);

  return (
    <div style={{ width: shape.props.w, height: shape.props.h, position: 'relative' }}>
      <MermaidStreamRenderer
        mermaidText={String(shape.props.mermaidText || '')}
        keepLastGood={shape.props.keepLastGood !== false}
        onCompileStateChange={handleState}
        onFitMeasured={handleFit}
        showInlineErrorBadge={false}
      />
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
              const unsafeEditor = editor as any;
              unsafeEditor?.updateShapes?.([
                { id: shape.id as any, type: 'mermaid_stream' as const, props: { w: size.w, h: size.h } } as any,
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
            try {
              navigator.clipboard?.writeText(String(shape.props.mermaidText || ''));
            } catch {}
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
              const unsafeEditor = editor as any;
              unsafeEditor?.updateShapes?.([
                {
                  id: shape.id as any,
                  type: 'mermaid_stream' as const,
                  props: { keepLastGood: !(shape.props.keepLastGood !== false) },
                } as any,
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
            onChange={(event) => {
              const value = event.target.value;
              setLocalText(value);
              if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
              editDebounceRef.current = setTimeout(() => applyText(value), 150);
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
