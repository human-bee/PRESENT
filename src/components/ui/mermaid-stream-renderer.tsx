'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { nanoid } from 'nanoid';

export type MermaidCompileState = 'idle' | 'compiling' | 'ok' | 'error';

export interface MermaidStreamRendererProps {
  mermaidText: string;
  keepLastGood?: boolean;
  className?: string;
  /** Called when compile state changes (for telemetry/UX) */
  onCompileStateChange?: (state: MermaidCompileState, info?: { ms?: number; error?: string }) => void;
  /** Called after a successful render with measured SVG size (for Fit to content) */
  onFitMeasured?: (size: { w: number; h: number }) => void;
  /** Debounce in ms for rendering; defaults to 160 */
  debounceMs?: number;
}

declare global {
  interface Window {
    mermaid?: any;
    __present_mermaid_loaded__?: boolean;
  }
}

/**
 * Lightweight, debounced Mermaid renderer that tolerates partial graphs during streaming.
 * - Loads mermaid from CDN on demand to avoid bundler install.
 * - Sanitizes input and preserves last good SVG on error when keepLastGood is true.
 */
export function MermaidStreamRenderer({
  mermaidText,
  keepLastGood = true,
  className,
  onCompileStateChange,
  onFitMeasured,
  debounceMs = 160,
}: MermaidStreamRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastGoodSvgRef = useRef<string>('');
  const lastErrorRef = useRef<string | null>(null);
  const compileIdRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Ensure mermaid script present (CDN). Avoid duplicate loads.
  const ensureMermaid = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (window.mermaid) return;
    if (window.__present_mermaid_loaded__) return;
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      // Pin to a known stable v10 which supports mermaidAPI.render and works well in browsers
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
      script.async = true;
      script.onload = () => {
        try {
          window.__present_mermaid_loaded__ = true;
          if (window.mermaid?.initialize) {
            window.mermaid.initialize({
              startOnLoad: false,
              securityLevel: 'strict',
              htmlLabels: false,
              theme: 'default',
              flowchart: { htmlLabels: false },
              sequence: { useMaxWidth: true },
              // Keep parsing permissive but safe
            });
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      script.onerror = () => reject(new Error('Failed to load mermaid'));
      document.head.appendChild(script);
    });
  }, []);

  const sanitizeInput = useCallback((input: string) => {
    // Clamp size to prevent DoS
    const MAX_LEN = 8000;
    let text = (input || '').slice(0, MAX_LEN);
    // Strip unsafe directive blocks like %%{init: ...}%%
    text = text.replace(/%%\{[\s\S]*?\}%%/g, '');
    return text;
  }, []);

  const renderMermaid = useCallback(async (text: string) => {
    const start = performance.now();
    onCompileStateChange?.('compiling');
    try {
      await ensureMermaid();
      const m = window.mermaid;
      if (!m?.mermaidAPI?.render) throw new Error('Mermaid API not available');
      const id = `m-${nanoid(8)}`;
      const safeText = sanitizeInput(text);
      const { svg } = await m.mermaidAPI.render(id, safeText);
      // Sanitize SVG output defensively
      const cleanSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      const el = containerRef.current;
      if (el && mountedRef.current) {
        el.innerHTML = cleanSvg;
        lastGoodSvgRef.current = cleanSvg;
        lastErrorRef.current = null;
        // Measure SVG size
        const svgEl = el.querySelector('svg') as SVGSVGElement | null;
        if (svgEl) {
          // Try viewBox then bounding box
          const vb = svgEl.getAttribute('viewBox');
          if (vb) {
            const parts = vb.trim().split(/\s+/).map(Number);
            if (parts.length === 4) {
              onFitMeasured?.({ w: parts[2], h: parts[3] });
            }
          } else if ((svgEl as any).getBBox) {
            try {
              const b = (svgEl as any).getBBox();
              onFitMeasured?.({ w: b.width, h: b.height });
            } catch {}
          }
        }
      }
      const ms = Math.round(performance.now() - start);
      onCompileStateChange?.('ok', { ms });
    } catch (err: any) {
      const el = containerRef.current;
      const msg = err?.message ? String(err.message) : 'Mermaid render failed';
      lastErrorRef.current = msg;
      if (el && mountedRef.current) {
        if (keepLastGood && lastGoodSvgRef.current) {
          el.innerHTML = lastGoodSvgRef.current;
        } else {
          el.innerHTML = '';
        }
      }
      onCompileStateChange?.('error', { error: msg });
    }
  }, [ensureMermaid, keepLastGood, onCompileStateChange, onFitMeasured, sanitizeInput]);

  const schedule = useCallback((text: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const myId = ++compileIdRef.current;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Coalesce rapid updates; only the last scheduled id should render
      if (myId === compileIdRef.current) renderMermaid(text);
    }, Math.max(60, debounceMs));
  }, [debounceMs, renderMermaid]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Re-render when input changes
  useEffect(() => {
    schedule(mermaidText || '');
  }, [mermaidText, schedule]);

  return (
    <div className={className} style={{ width: '100%', height: '100%', overflow: 'auto' }}>
      <div ref={containerRef} />
      {/* Subtle inline error badge (non-intrusive) */}
      {lastErrorRef.current && (
        <div
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            background: 'rgba(255, 59, 48, 0.12)',
            color: '#B00020',
            border: '1px solid rgba(255, 59, 48, 0.3)',
            padding: '4px 6px',
            borderRadius: 6,
            fontSize: 11,
          }}
        >
          Mermaid error – keeping last good render
        </div>
      )}
    </div>
  );
}

export default MermaidStreamRenderer;
