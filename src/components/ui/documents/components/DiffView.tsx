import React from 'react';

type DiffViewProps = {
  before: string;
  after: string;
};

export function DiffView({ before, after }: DiffViewProps) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 px-4 py-6">
      <article className="rounded-lg border border-slate-800 p-4">
        <h3 className="text-xs uppercase tracking-wide text-slate-400">Before</h3>
        <div className="prose prose-invert max-w-none mt-2" dangerouslySetInnerHTML={{ __html: before }} />
      </article>
      <article className="rounded-lg border border-slate-800 p-4">
        <h3 className="text-xs uppercase tracking-wide text-slate-400">After</h3>
        <div className="prose prose-invert max-w-none mt-2" dangerouslySetInnerHTML={{ __html: after }} />
      </article>
    </section>
  );
}
