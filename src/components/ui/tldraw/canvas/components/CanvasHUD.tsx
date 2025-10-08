"use client";

interface CanvasHUDProps {
  zoom: number;
  selectionCount: number;
}

export function CanvasHUD({ zoom, selectionCount }: CanvasHUDProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        padding: '8px 12px',
        borderRadius: 12,
        background: 'rgba(17, 24, 39, 0.75)',
        color: 'white',
        fontSize: 12,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <span>Zoom: {(zoom * 100).toFixed(0)}%</span>
      <span>Selected: {selectionCount}</span>
    </div>
  );
}

