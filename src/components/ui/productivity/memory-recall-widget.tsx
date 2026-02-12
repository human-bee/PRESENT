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
import { WidgetFrame } from './widget-frame';

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

  const fallbackIdRef = useRef<string | null>(null);
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
    <WidgetFrame
      title={state.title}
      subtitle="Vector recall via MCP"
      meta={state.lastUpdated ? `Updated ${new Date(state.lastUpdated).toLocaleTimeString()}` : 'Idle'}
      className={className}
      bodyClassName="space-y-4"
    >
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            value={state.query}
            onChange={(e) => setState((prev) => ({ ...prev, query: e.target.value }))}
            placeholder="Search vector memory…"
            className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Search
            </Button>
            <span className="text-xs text-secondary">
              {status === 'searching' ? 'Searching…' : state.results.length ? `${state.results.length} hits` : 'No results yet'}
            </span>
          </div>
        </form>

        {error && (
          <div className="rounded-lg border border-danger-outline bg-danger-surface px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <MemoryRecallResults hits={state.results} />
        </div>
    </WidgetFrame>
  );
}
