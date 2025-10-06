import React from 'react';
import { Clock } from 'lucide-react';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  showTime?: boolean;
  elapsedTime?: number;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ProgressIndicator({ current, total, showTime = false, elapsedTime = 0 }: ProgressIndicatorProps) {
  return (
    <div className="flex items-center space-x-3 text-sm text-slate-300">
      <span className="font-mono">
        {current + 1}/{total}
      </span>
      <div className="w-32 h-1 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-blue-400 rounded-full transition-all duration-300" style={{ width: `${((current + 1) / total) * 100}%` }} />
      </div>
      {showTime && (
        <span className="font-mono text-slate-400">
          <Clock size={12} className="inline mr-1" />
          {formatTime(elapsedTime)}
        </span>
      )}
    </div>
  );
}
