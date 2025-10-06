'use client';

import { ArrowUp } from 'lucide-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  DiffView,
  MarkdownArticleHeader,
  MarkdownImageModal,
  MarkdownPreview,
  MarkdownTOCPanel,
  MarkdownViewerTopBar,
} from './components';
import {
  useCanvasGuards,
  useDiffAutoscroll,
  useDiffRenderer,
  useMarkdownPipeline,
  useMarkdownReadingProgress,
  useMarkdownTOC,
} from './hooks';

// Define the component props schema with Zod
export const markdownViewerEditableSchema = z.object({
  title: z.string().describe('Title of the document'),
  content: z.string().optional().describe('Markdown content to display'),
  titleImage: z.string().optional().describe('URL of the title image to display at the top'),
  author: z.string().optional().describe('Document author'),
  readTime: z.number().optional().describe('Estimated read time in minutes'),
  publishDate: z.string().optional().describe('Publish date'),
  diffs: z
    .array(
      z.object({
        type: z.enum(['added', 'removed']),
        content: z.string(),
        lineNumber: z.number(),
        wordIndex: z.number(),
      }),
    )
    .optional()
    .describe('Diff information to display'),
});

// Define the props type based on the Zod schema
export type MarkdownViewerEditableProps = z.infer<typeof markdownViewerEditableSchema>;

export function MarkdownViewerEditable({
  title,
  content = '',
  titleImage,
  author,
  readTime,
  publishDate,
  diffs,
}: MarkdownViewerEditableProps) {
  const [fontSize, setFontSize] = useState(16);
  const [showTOC, setShowTOC] = useState(false);
  const [showDiffs, setShowDiffs] = useState(false);
  const [imageModal, setImageModal] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const canvasGuards = useCanvasGuards();
  const { render: renderMarkdown } = useMarkdownPipeline({ onImageClick: setImageModal });
  const { renderDiff } = useDiffRenderer();
  const { progress: readingProgress, currentHeading } = useMarkdownReadingProgress(contentRef);
  const { toc, scrollToHeading } = useMarkdownTOC(content, contentRef);
  useDiffAutoscroll(contentRef, showDiffs ? diffs ?? [] : undefined);

  const handleSelectHeading = useCallback(
    (id: string) => {
      scrollToHeading(id);
      setShowTOC(false);
    },
    [scrollToHeading],
  );

  const handleDecreaseFont = useCallback(() => {
    setFontSize((value) => Math.max(value - 2, 12));
  }, []);

  const handleIncreaseFont = useCallback(() => {
    setFontSize((value) => Math.min(value + 2, 24));
  }, []);

  const handleBackToTop = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleCloseImageModal = useCallback(() => {
    setImageModal(null);
  }, []);

  const wordCount = useMemo(() => content.split(/\s+/).filter((word) => word.length > 0).length, [content]);
  const estimatedReadTime = readTime || Math.ceil(wordCount / 200);
  const hasDiffs = Boolean(diffs && diffs.length > 0);

  const modalGuards = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { onClick: _omitClick, ...rest } = canvasGuards;
    return rest;
  }, [canvasGuards]);

  return (
    <div
      ref={containerRef}
      className="h-[1100px] bg-slate-950 text-slate-100 rounded-2xl overflow-hidden flex flex-col w-[700px]"
      style={{ pointerEvents: 'auto' }}
      {...canvasGuards}
    >
      <MarkdownViewerTopBar
        title={title}
        currentHeading={currentHeading}
        hasDiffs={hasDiffs}
        showDiffs={showDiffs}
        onToggleDiff={() => setShowDiffs((value) => !value)}
        fontSize={fontSize}
        onDecreaseFont={handleDecreaseFont}
        onIncreaseFont={handleIncreaseFont}
        tocCount={toc.length}
        showTOC={showTOC}
        onToggleTOC={() => setShowTOC((value) => !value)}
        readingProgress={readingProgress}
      />

      <div className="relative flex h-[calc(100%-4rem)]">
        <MarkdownTOCPanel visible={showTOC} toc={toc} onSelectHeading={handleSelectHeading} />

        <div className="flex-1 flex flex-col">
          <div ref={contentRef} className="flex-1 overflow-y-auto" {...canvasGuards}>
            <article className="max-w-4xl mx-auto px-8 py-12">
              <MarkdownArticleHeader
                title={title}
                titleImage={titleImage}
                author={author}
                publishDate={publishDate}
                estimatedReadTime={estimatedReadTime}
                wordCount={wordCount}
                onImageClick={setImageModal}
              />

              {showDiffs && hasDiffs && <DiffView content={renderDiff(diffs)} />}

              <MarkdownPreview fontSize={fontSize}>{renderMarkdown(content || '')}</MarkdownPreview>

              <div className="mt-16 pt-8 border-t border-slate-800 text-center">
                <button
                  type="button"
                  onClick={handleBackToTop}
                  className="inline-flex items-center space-x-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors"
                >
                  <ArrowUp size={16} />
                  <span>Back to top</span>
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>

      {imageModal && (
        <MarkdownImageModal src={imageModal} onClose={handleCloseImageModal} guards={modalGuards} />
      )}
    </div>
  );
}

export default MarkdownViewerEditable;
