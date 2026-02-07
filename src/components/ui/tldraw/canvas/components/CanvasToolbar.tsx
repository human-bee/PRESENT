"use client";

import type { ReactNode } from 'react';

interface CanvasToolbarProps {
  children?: ReactNode;
  onExport?: (format: 'png' | 'svg' | 'json') => void;
  onImport?: () => void;
}

export function CanvasToolbar({ children, onExport, onImport }: CanvasToolbarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        rowGap: 6,
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 12,
        padding: '6px 8px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 32px)',
        overflowX: 'visible',
        overflowY: 'auto',
        boxShadow: '0 8px 18px rgba(0,0,0,0.08)',
        zIndex: 2000,
        pointerEvents: 'auto',
      }}
    >
      <button className="tlui-button tlui-button__tool" onClick={() => onExport?.('png')}>
        Export PNG
      </button>
      <button className="tlui-button tlui-button__tool" onClick={() => onExport?.('svg')}>
        Export SVG
      </button>
      <button className="tlui-button tlui-button__tool" onClick={() => onExport?.('json')}>
        Export JSON
      </button>
      <button className="tlui-button tlui-button__tool" onClick={onImport}>
        Import JSON
      </button>
      <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.1)', margin: '0 4px' }} />
      <button
        className="tlui-button tlui-button__tool"
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tldraw:create_shape', {
              detail: {
                type: 'toolbox',
                x: 100,
                y: 100,
                props: { w: 56, h: 560, name: 'Component Toolbox' }
              }
            }));
          }
        }}
        title="Open Component Toolbox"
      >
        Toolbox
      </button>
      {children}
    </div>
  );
}
