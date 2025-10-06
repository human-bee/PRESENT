import { useMemo } from 'react';

type MarkdownPipelineOptions = {
  sanitize?: (html: string) => string;
};

type MarkdownRenderer = (markdown: string) => string;

export function useMarkdownPipeline(options: MarkdownPipelineOptions = {}) {
  const { sanitize } = options;

  const render = useMemo<MarkdownRenderer>(() => {
    return (markdown: string) => {
      const output = markdown ?? '';
      return sanitize ? sanitize(output) : output;
    };
  }, [sanitize]);

  return { render };
}
