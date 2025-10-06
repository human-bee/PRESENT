import React from 'react';
import type { ReactNode } from 'react';

interface DiffViewProps {
  content: ReactNode;
}

export function DiffView({ content }: DiffViewProps) {
  return (
    <div className="mb-8 p-6 bg-slate-900 border border-slate-700 rounded-lg">
      <h2 className="text-xl font-semibold text-white mb-4">Recent Changes</h2>
      <div className="overflow-x-auto">{content}</div>
    </div>
  );
}
