'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/shared/button';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import type { MemoryTarget } from '@/lib/mcp/memory';
import type { MemoryHit, MemoryRecallState, MemoryRecallWidgetProps } from './memory-recall-schema';
import {
  normalizeMemoryRecallState,
} from './memory-recall-utils';
import { MemoryRecallResults } from './memory-recall-results';
import { useMemoryRecallSearch } from './memory-recall-search';

const DEFAULT_MEMORY_RECALL_TOOL = process.env.NEXT_PUBLIC_MEMORY_RECALL_MCP_TOOL;
const DEFAULT_MEMORY_RECALL_COLLECTION = process.env.NEXT_PUBLIC_MEMORY_RECALL_MCP_COLLECTION;
const DEFAULT_MEMORY_RECALL_INDEX = process.env.NEXT_PUBLIC_MEMORY_RECALL_MCP_INDEX;
const DEFAULT_MEMORY_RECALL_NAMESPACE = process.env.NEXT_PUBLIC_MEMORY_RECALL_MCP_NAMESPACE;
const DEFAULT_MEMORY_RECALL_AUTO_SEARCH = process.env.NEXT_PUBLIC_MEMORY_RECALL_AUTO_SEARCH === 'true';

export { memoryRecallWidgetSchema } from './memory-recall-schema';

export default function MemoryRecallWidget(props: MemoryRecallWidgetProps) {
  const {
    __custom_message_id,
    messageId: propMessageId,
    contextKey,
    className,
    ...initial
  } = props;

  const fallbackIdRef = useRef<string>();
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `memory-recall-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const [state, setState] = useState<MemoryRecallState>(() =>
    normalizeMemoryRecallState({
      ...initial,
      toolName: initial.toolName ?? DEFAULT_MEMORY_RECALL_TOOL ?? undefined,
      memoryCollection: initial.memoryCollection ?? DEFAULT_MEMORY_RECALL_COLLECTION ?? undefined,
      memoryIndex: initial.memoryIndex ?? DEFAULT_MEMORY_RECALL_INDEX ?? undefined,
      memoryNamespace: initial.memoryNamespace ?? DEFAULT_MEMORY_RECALL_NAMESPACE ?? undefined,
      autoSearch:
        typeof initial.autoSearch === 'boolean'
          ? initial.autoSearch
          : DEFAULT_MEMORY_RECALL_AUTO_SEARCH,
    }),
  );

  const target = useMemo<MemoryTarget>(
    () => ({
      collection: state.memoryCollection,
      index: state.memoryIndex,
      namespace: state.memoryNamespace,
    }),
    [state.memoryCollection, state.memoryIndex, state.memoryNamespace],
  );

  const { error, status, runSearch, runSearchRef } = useMemoryRecallSearch({
    state,
    target,
    onUpdate: (hits, timestamp) => {
      setState((prev) => ({
        ...prev,
        results: hits,
        lastUpdated: timestamp,
      }));
    },
  });

  const applyPatch = useCallback(
    (patch: Record<string, unknown>) => {
      setState((prev) => {
        const next: MemoryRecallState = { ...prev };
        if (typeof patch.title === 'string') next.title = patch.title.trim() || prev.title;
        if (typeof patch.query === 'string') next.query = patch.query.trim();
        if (Array.isArray(patch.results)) next.results = patch.results as MemoryHit[];
        if (typeof patch.toolName === 'string') next.toolName = patch.toolName;
        if (typeof patch.memoryCollection === 'string') next.memoryCollection = patch.memoryCollection;
        if (typeof patch.memoryIndex === 'string') next.memoryIndex = patch.memoryIndex;
        if (typeof patch.memoryNamespace === 'string') next.memoryNamespace = patch.memoryNamespace;
        if (typeof patch.autoSearch === 'boolean') next.autoSearch = patch.autoSearch;
        if (typeof patch.lastUpdated === 'number') next.lastUpdated = patch.lastUpdated;
        return next;
      });

    if (patch.searchNow === true || patch.search === true) {
      const nextQuery = typeof patch.query === 'string' ? patch.query : state.query;
      setTimeout(() => {
        runSearchRef.current(nextQuery, { force: true });
      }, 0);
    }
  },
  [state.query],
);

  const registryProps = useMemo(
    () => ({
      title: state.title,
      query: state.query,
      results: state.results,
      toolName: state.toolName,
      memoryCollection: state.memoryCollection,
      memoryIndex: state.memoryIndex,
      memoryNamespace: state.memoryNamespace,
      autoSearch: state.autoSearch,
      lastUpdated: state.lastUpdated,
      className,
    }),
    [className, state],
  );

  useComponentRegistration(
    messageId,
    'MemoryRecallWidget',
    registryProps,
    contextKey || 'canvas',
    applyPatch,
  );

  useEffect(() => {
    if (!state.autoSearch) return;
    if (!state.query.trim()) return;
    const timer = window.setTimeout(() => runSearch(), 200);
    return () => window.clearTimeout(timer);
  }, [runSearch, state.autoSearch, state.query]);

  const handleSubmit = (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    runSearch(undefined, { force: true });
  };

  return (
    <div className={cn('w-full rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-900">{state.title}</span>
          <span className="text-xs text-slate-500">Vector recall via MCP</span>
        </div>
        <div className="text-xs text-slate-400">
          {state.lastUpdated ? `Updated ${new Date(state.lastUpdated).toLocaleTimeString()}` : 'Idle'}
        </div>
      </div>
      <div className="p-4 space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            value={state.query}
            onChange={(e) => setState((prev) => ({ ...prev, query: e.target.value }))}
            placeholder="Search vector memory…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" className="bg-blue-600 text-white hover:bg-blue-500">
              Search
            </Button>
            <span className="text-xs text-slate-500">
              {status === 'searching' ? 'Searching…' : state.results.length ? `${state.results.length} hits` : 'No results yet'}
            </span>
          </div>
        </form>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <MemoryRecallResults hits={state.results} />
        </div>
      </div>
    </div>
  );
}
