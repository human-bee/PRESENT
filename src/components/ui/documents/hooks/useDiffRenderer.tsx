/* eslint-disable react/display-name */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { DiffWord } from '@/lib/stores/document-state';
import { cn } from '@/lib/utils';

type DiffRendererOptions = {
  emptyFallback?: ReactNode;
};

export function useDiffRenderer(options: DiffRendererOptions = {}) {
  const { emptyFallback = (
    <div className="text-slate-400 italic text-center py-4">No changes detected</div>
  ) } = options;

  const renderDiff = useMemo(() => {
    return (diffWords: DiffWord[] | undefined | null): ReactNode => {
      if (!diffWords || diffWords.length === 0) {
        return emptyFallback;
      }

      const changesByLine = diffWords.reduce<Record<number, DiffWord[]>>((acc, word) => {
        if (!acc[word.lineNumber]) {
          acc[word.lineNumber] = [];
        }
        acc[word.lineNumber].push(word);
        return acc;
      }, {});

      return (
        <div className="space-y-3">
          {Object.entries(changesByLine).map(([lineNumber, words]) => (
            <div key={lineNumber} className="bg-slate-800/50 rounded-lg p-3" data-diff-line={lineNumber}>
              <div className="text-xs text-slate-500 mb-2">Line {lineNumber}</div>
              <div className="flex flex-wrap gap-1">
                {words.map((word, index) => (
                  <span
                    key={`${lineNumber}-${index}`}
                    className={cn(
                      'px-2 py-1 rounded text-sm font-mono',
                      word.type === 'added' && 'bg-green-900/50 text-green-300 border border-green-500/30',
                      word.type === 'removed' &&
                        'bg-red-900/50 text-red-300 border border-red-500/30 line-through',
                    )}
                  >
                    {word.content}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    };
  }, [emptyFallback]);

  return { renderDiff };
}
