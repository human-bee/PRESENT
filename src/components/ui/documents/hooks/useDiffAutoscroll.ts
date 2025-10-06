import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { DiffWord } from '@/lib/stores/document-state';

export function useDiffAutoscroll(
  containerRef: RefObject<HTMLElement | null>,
  diffs?: DiffWord[] | null,
) {
  const lastSerializedDiffs = useRef<string>('');

  useEffect(() => {
    if (!diffs || diffs.length === 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const serialized = JSON.stringify(diffs);
    if (serialized === lastSerializedDiffs.current) {
      return;
    }

    const firstDiffLine = Math.min(...diffs.map((diff) => diff.lineNumber));

    const timeoutId = window.setTimeout(() => {
      const directMatch = container.querySelector(
        `[data-line="${firstDiffLine}"]`,
      ) as HTMLElement | null;

      const codeBlockMatch = container.querySelector(
        `[data-line-start][data-line-end]`,
      ) as HTMLElement | null;

      let elementToScroll: HTMLElement | null = directMatch;

      if (!elementToScroll && codeBlockMatch) {
        const startLine = parseInt(codeBlockMatch.getAttribute('data-line-start') || '0', 10);
        const endLine = parseInt(codeBlockMatch.getAttribute('data-line-end') || '0', 10);

        if (firstDiffLine >= startLine && firstDiffLine <= endLine) {
          elementToScroll = codeBlockMatch;
        }
      }

      if (elementToScroll) {
        elementToScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
        elementToScroll.classList.add(
          'ring-2',
          'ring-yellow-500',
          'ring-opacity-50',
          'bg-yellow-500/10',
        );

        window.setTimeout(() => {
          elementToScroll?.classList.remove(
            'ring-2',
            'ring-yellow-500',
            'ring-opacity-50',
            'bg-yellow-500/10',
          );
        }, 3000);
      }
    }, 200);

    lastSerializedDiffs.current = serialized;

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [containerRef, diffs]);
}
