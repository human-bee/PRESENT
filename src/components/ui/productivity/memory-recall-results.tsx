'use client';

import type { MemoryHit } from './memory-recall-schema';

type MemoryRecallResultsProps = {
  hits: MemoryHit[];
};

export function MemoryRecallResults({ hits }: MemoryRecallResultsProps) {
  if (hits.length === 0) {
    return (
      <div className="text-xs text-slate-400">
        Enter a query to recall summaries, infographics, and context snapshots.
      </div>
    );
  }

  return (
    <>
      {hits.map((hit, index) => {
        const meta = hit.metadata || {};
        const metaTitle = typeof meta.title === 'string' ? meta.title : '';
        const tags = Array.isArray(meta.tags) ? meta.tags.filter((tag) => typeof tag === 'string') : [];
        const displayText = hit.text && hit.text.length > 1200 ? `${hit.text.slice(0, 1200)}...` : hit.text;
        return (
          <div
            key={`${hit.id || 'hit'}-${index}`}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
          >
            {metaTitle && <div className="mb-1 text-[11px] font-semibold text-slate-900">{metaTitle}</div>}
            <div className="whitespace-pre-wrap text-[12px] leading-5">
              {displayText || 'No text found'}
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.slice(0, 6).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
