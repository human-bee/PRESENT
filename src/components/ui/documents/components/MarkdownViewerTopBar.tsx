import React from 'react';
import { BookOpen, Eye, EyeOff, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownViewerTopBarProps {
  title: string;
  currentHeading: string;
  hasDiffs: boolean;
  showDiffs: boolean;
  onToggleDiff: () => void;
  fontSize: number;
  onDecreaseFont: () => void;
  onIncreaseFont: () => void;
  tocCount: number;
  showTOC: boolean;
  onToggleTOC: () => void;
  readingProgress: number;
}

export function MarkdownViewerTopBar(props: MarkdownViewerTopBarProps) {
  const {
    title,
    currentHeading,
    hasDiffs,
    showDiffs,
    onToggleDiff,
    fontSize,
    onDecreaseFont,
    onIncreaseFont,
    tocCount,
    showTOC,
    onToggleTOC,
    readingProgress,
  } = props;

  return (
    <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-xl border-b border-slate-800 flex-shrink-0">
      <div className="h-1 bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
          style={{ width: `${readingProgress}%` }}
        />
      </div>

      <div className="max-w-5xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-white truncate max-w-md">{title}</h1>
            {currentHeading && (
              <span className="text-sm text-slate-400 hidden md:block">/ {currentHeading}</span>
            )}
            {hasDiffs && <span className="text-sm text-yellow-400 hidden md:block">Has recent changes</span>}
          </div>

          <div className="flex items-center space-x-2">
            {hasDiffs && (
              <button
                type="button"
                onClick={onToggleDiff}
                className={cn(
                  'p-2 rounded-lg transition-colors',
                  showDiffs
                    ? 'bg-blue-700 text-white'
                    : 'hover:bg-slate-800 text-slate-400 hover:text-slate-300',
                )}
                title={showDiffs ? 'Hide diff view' : 'Show diff view'}
              >
                {showDiffs ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}

            <button
              type="button"
              onClick={onDecreaseFont}
              className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-300"
            >
              <ZoomOut size={16} />
            </button>
            <span className="text-xs text-slate-500 w-8 text-center">{fontSize}</span>
            <button
              type="button"
              onClick={onIncreaseFont}
              className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-300"
            >
              <ZoomIn size={16} />
            </button>

            {tocCount > 0 && (
              <button
                type="button"
                onClick={onToggleTOC}
                className={cn(
                  'p-2 rounded-lg transition-colors',
                  showTOC
                    ? 'bg-slate-700 text-white'
                    : 'hover:bg-slate-800 text-slate-400 hover:text-slate-300',
                )}
              >
                <BookOpen size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
