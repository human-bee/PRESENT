import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

type ReadingProgress = {
  progress: number;
  currentHeading: string;
};

export function useMarkdownReadingProgress(containerRef: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState<ReadingProgress>({ progress: 0, currentHeading: '' });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight - container.clientHeight;
      const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
      let currentHeading = '';

      for (let i = headings.length - 1; i >= 0; i -= 1) {
        const heading = headings[i] as HTMLElement;
        if (heading.offsetTop <= scrollTop + 100) {
          currentHeading = heading.textContent || '';
          break;
        }
      }

      setState({
        progress: Math.min(Math.max(progress, 0), 100),
        currentHeading,
      });
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef]);

  return state;
}
