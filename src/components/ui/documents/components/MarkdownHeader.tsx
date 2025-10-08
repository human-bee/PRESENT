import React from 'react';

type MarkdownHeaderProps = {
  title?: string;
  onTogglePreview?: () => void;
};

export function MarkdownHeader({ title, onTogglePreview }: MarkdownHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-200">{title ?? 'Markdown'}</h2>
      {onTogglePreview && (
        <button
          type="button"
          className="text-xs text-blue-400 hover:text-blue-300"
          onClick={onTogglePreview}
        >
          Toggle Preview
        </button>
      )}
    </header>
  );
}
