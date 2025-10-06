import { useMemo, useCallback } from 'react';
import type { RefObject } from 'react';

export type MarkdownTOCItem = {
  id: string;
  title: string;
  level: number;
};

export function useMarkdownTOC(markdown: string, containerRef: RefObject<HTMLDivElement | null>) {
  const toc = useMemo<MarkdownTOCItem[]>(() => {
    if (!markdown) {
      return [];
    }

    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const items: MarkdownTOCItem[] = [];
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(markdown)) !== null) {
      const level = match[1].length;
      const title = match[2].trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      items.push({ id, title, level });
    }

    return items;
  }, [markdown]);

  const scrollToHeading = useCallback(
    (id: string) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const target = container.querySelector(`#${id}`) as HTMLElement | null;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [containerRef],
  );

  return { toc, scrollToHeading };
}
