import React from 'react';

interface OverlayLayerProps {
  showShortcuts: boolean;
}

export function OverlayLayer({ showShortcuts }: OverlayLayerProps) {
  if (!showShortcuts) {
    return null;
  }

  return (
    <div className="absolute top-4 right-4 bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-lg p-3 text-xs text-slate-300">
      <div className="font-semibold mb-2">Shortcuts</div>
      <div className="space-y-1">
        <div>← → Space: Navigate</div>
        <div>Enter: Play/Pause</div>
        <div>F: Fullscreen</div>
        <div>L: Laser pointer</div>
        <div>Esc: Exit</div>
      </div>
    </div>
  );
}
