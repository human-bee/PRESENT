import { useEffect, useRef, useState, type RefObject } from 'react';
import { readMeasuredElementSize, type WidgetSize } from './custom-widget-sizing';

export function useMeasuredCustomWidgetSize({
  enabled,
  contentRef,
  resetKey,
}: {
  enabled: boolean;
  contentRef: RefObject<HTMLElement | null>;
  resetKey: unknown;
}): WidgetSize | null {
  const [measuredSize, setMeasuredSize] = useState<WidgetSize | null>(null);
  const lastMeasuredSizeRef = useRef<WidgetSize | null>(null);

  const updateMeasuredSize = (el: HTMLElement) => {
    const next = readMeasuredElementSize(el);
    const prev = lastMeasuredSizeRef.current;
    if (!prev || Math.abs(prev.w - next.w) > 1 || Math.abs(prev.h - next.h) > 1) {
      lastMeasuredSizeRef.current = next;
      setMeasuredSize(next);
    }
  };

  useEffect(() => {
    lastMeasuredSizeRef.current = null;
    setMeasuredSize(null);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) return;
    const el = contentRef.current;
    if (!el) return;

    let frame: number | null = null;
    const measure = () => updateMeasuredSize(el);

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
  }, [enabled, contentRef]);

  useEffect(() => {
    if (!enabled) return;
    const el = contentRef.current;
    if (!el) return;

    const frame = requestAnimationFrame(() => {
      updateMeasuredSize(el);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  });

  return measuredSize;
}
