import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { markdownShortcuts } from '../utils';
import { renderMarkdownToElements } from '../utils/markdown-renderer';

export type MarkdownPipelineOptions = {
  onImageClick?: (src: string) => void;
};

export function useMarkdownPipeline(options: MarkdownPipelineOptions = {}) {
  const { onImageClick } = options;

  const render = useMemo(() => {
    return (markdown: string): ReactNode => renderMarkdownToElements(markdown, onImageClick);
  }, [onImageClick]);

  return {
    render,
    shortcuts: markdownShortcuts,
  };
}
