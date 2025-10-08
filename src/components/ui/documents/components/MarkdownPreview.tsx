import React from 'react';
import type { ReactNode } from 'react';

interface MarkdownPreviewProps {
  children: ReactNode;
  fontSize?: number;
}

export function MarkdownPreview({ children, fontSize = 16 }: MarkdownPreviewProps) {
  return (
    <section className="prose prose-invert prose-lg max-w-none" style={{ fontSize: `${fontSize}px` }}>
      <div className="text-slate-300 leading-relaxed">{children}</div>
    </section>
  );
}
