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
        position: 'absolute',
        top: 16,
        left: 16,
        display: 'flex',
        gap: 8,
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 12,
        padding: '6px 8px',
        boxShadow: '0 8px 18px rgba(0,0,0,0.08)',
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
      {children}
    </div>
  );
}
