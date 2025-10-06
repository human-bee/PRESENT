/* eslint-disable @next/next/no-img-element */
import React from 'react';
import type { ReactNode } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { sanitizeHtml } from './sanitizeSchema';

export function renderMarkdownToElements(markdown: string, onImageClick?: (src: string) => void): ReactNode {
  if (!markdown || markdown.trim() === '') {
    return <div className="text-slate-500 italic text-center">No content available</div>;
  }

  const lines = markdown.split('\n');
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeBlockStartLine = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div
            key={`code-${index}`}
            className="my-6 rounded-xl overflow-hidden bg-slate-900 border border-slate-700"
            data-line-start={codeBlockStartLine}
            data-line-end={lineNumber}
          >
            <div className="bg-slate-800 px-4 py-2 text-xs text-slate-400 font-mono">Code</div>
            <pre className="p-4 overflow-x-auto">
              <code className="text-sm font-mono text-green-400">{codeContent.join('\n')}</code>
            </pre>
          </div>,
        );
        codeContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockStartLine = lineNumber;
      }
      return;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      return;
    }

    const imageMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      const [, alt, src] = imageMatch;
      elements.push(
        <div key={`img-${index}`} className="my-8 text-center" data-line={lineNumber}>
          <button
            type="button"
            className="inline-block cursor-pointer group transition-all duration-300 hover:scale-105"
            onClick={() => onImageClick?.(src)}
          >
            <img
              src={src}
              alt={alt}
              className="max-w-full h-auto rounded-xl shadow-lg"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 mt-2">
              <span className="text-xs text-slate-400 flex items-center justify-center gap-1">
                <ImageIcon size={12} />
                Click to expand
              </span>
            </div>
          </button>
          {alt && <p className="text-sm text-slate-500 mt-2 italic">{alt}</p>}
        </div>,
      );
      return;
    }

    if (line.startsWith('# ')) {
      const text = line.substring(2);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      elements.push(
        <h1 key={`h1-${index}`} id={id} className="font-bold text-white scroll-mt-20 text-4xl mb-6 mt-8" data-line={lineNumber}>
          {text}
        </h1>,
      );
      return;
    }

    if (line.startsWith('## ')) {
      const text = line.substring(3);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      elements.push(
        <h2 key={`h2-${index}`} id={id} className="font-bold text-white scroll-mt-20 text-3xl mb-4 mt-6" data-line={lineNumber}>
          {text}
        </h2>,
      );
      return;
    }

    if (line.startsWith('### ')) {
      const text = line.substring(4);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      elements.push(
        <h3 key={`h3-${index}`} id={id} className="font-semibold text-white scroll-mt-20 text-2xl mb-3 mt-5" data-line={lineNumber}>
          {text}
        </h3>,
      );
      return;
    }

    const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/g);
    if (linkMatch) {
      let processedLine = line;
      linkMatch.forEach((match) => {
        const [, text, url] = match.match(/\[([^\]]+)\]\(([^)]+)\)/) || [];
        if (text && url) {
          processedLine = processedLine.replace(
            match,
            `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1 transition-colors">${text} <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg></a>`,
          );
        }
      });
      elements.push(
        <p
          key={`link-${index}`}
          className="mb-4 leading-relaxed text-slate-300"
          data-line={lineNumber}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(processedLine) }}
        />,
      );
      return;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li key={`li-${index}`} className="ml-6 mb-2 list-disc text-slate-300 leading-relaxed" data-line={lineNumber}>
          {line.substring(2)}
        </li>,
      );
      return;
    }

    if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-4 border-blue-500 pl-4 my-4 italic text-slate-400 bg-slate-800/30 py-2 rounded-r-lg"
          data-line={lineNumber}
        >
          {line.substring(2)}
        </blockquote>,
      );
      return;
    }

    if (line.trim()) {
      elements.push(
        <p key={`p-${index}`} className="mb-4 leading-relaxed text-slate-300" data-line={lineNumber}>
          {line}
        </p>,
      );
      return;
    }

    if (line === '') {
      elements.push(<br key={`br-${index}`} />);
    }
  });

  return elements;
}
