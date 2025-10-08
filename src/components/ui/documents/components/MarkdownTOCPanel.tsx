import React from 'react';
import type { MarkdownTOCItem } from '../hooks/useMarkdownTOC';
import { cn } from '@/lib/utils';

interface MarkdownTOCPanelProps {
  visible: boolean;
  toc: MarkdownTOCItem[];
  onSelectHeading: (id: string) => void;
}

export function MarkdownTOCPanel({ visible, toc, onSelectHeading }: MarkdownTOCPanelProps) {
  if (!visible) {
    return null;
  }

  if (toc.length === 0) {
    return null;
  }

  return (
    <div className="absolute top-24 right-6 z-30 w-64 rounded-xl border border-slate-800 bg-slate-900/95 p-4 shadow-xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">On this page</div>
      <nav className="space-y-2 text-sm">
        {toc.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectHeading(item.id)}
            className={cn(
              'block w-full text-left px-3 py-2 rounded-lg text-sm transition-colors hover:bg-slate-800',
              item.level === 1 && 'font-semibold text-white',
              item.level === 2 && 'text-slate-300 ml-2',
              item.level >= 3 && 'text-slate-400 ml-4',
            )}
          >
            {item.title}
          </button>
        ))}
      </nav>
    </div>
  );
}
