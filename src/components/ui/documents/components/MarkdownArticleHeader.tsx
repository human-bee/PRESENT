/* eslint-disable @next/next/no-img-element */
import React from 'react';
import { Clock, Image as ImageIcon, Type } from 'lucide-react';

interface MarkdownArticleHeaderProps {
  title: string;
  titleImage?: string;
  author?: string;
  publishDate?: string;
  estimatedReadTime: number;
  wordCount: number;
  onImageClick?: (src: string) => void;
}

export function MarkdownArticleHeader({
  title,
  titleImage,
  author,
  publishDate,
  estimatedReadTime,
  wordCount,
  onImageClick,
}: MarkdownArticleHeaderProps) {
  return (
    <header className="mb-12 pb-8 border-b border-slate-800">
      {titleImage && (
        <div className="mb-8">
          <button
            type="button"
            className="relative w-full rounded-xl overflow-hidden cursor-pointer group transition-all duration-300 hover:scale-[1.02]"
            onClick={() => onImageClick?.(titleImage)}
          >
            <img
              src={titleImage}
              alt={`${title} cover image`}
              className="w-full object-contain"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end">
              <div className="p-4 text-white">
                <span className="text-sm flex items-center gap-1">
                  <ImageIcon size={14} />
                  Click to expand
                </span>
              </div>
            </div>
          </button>
        </div>
      )}

      <h1 className="text-4xl font-bold text-white mb-6 leading-tight">{title}</h1>

      <div className="flex flex-wrap items-center gap-6 text-sm text-slate-400">
        {author && (
          <span className="flex items-center space-x-2">
            <span>By</span>
            <span className="text-slate-300 font-medium">{author}</span>
          </span>
        )}
        {publishDate && <span>{new Date(publishDate).toLocaleDateString()}</span>}
        <span className="flex items-center space-x-1">
          <Clock size={14} />
          <span>{estimatedReadTime} minute read</span>
        </span>
        <span className="flex items-center space-x-1">
          <Type size={14} />
          <span>{wordCount} words</span>
        </span>
      </div>
    </header>
  );
}
