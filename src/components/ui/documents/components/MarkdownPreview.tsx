import React from 'react';

type MarkdownPreviewProps = {
  content: string;
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <section className="prose prose-invert max-w-none px-4 py-6">
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </section>
  );
}
