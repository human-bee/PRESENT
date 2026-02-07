import { useCallback, useEffect, useRef, useState } from 'react';
import { waitForMcpReady } from '@/lib/mcp-bridge';
import { buildMemoryQueryPayload, type MemoryTarget } from '@/lib/mcp/memory';
import { normalizeMemoryRecallResults } from './memory-recall-utils';
import type { MemoryRecallState } from './memory-recall-schema';

type UseMemoryRecallSearchArgs = {
  state: MemoryRecallState;
  target: MemoryTarget;
  onUpdate: (hits: MemoryRecallState['results'], timestamp: number) => void;
};

export function useMemoryRecallSearch({
  state,
  target,
  onUpdate,
}: UseMemoryRecallSearchArgs) {
  const { query, toolName } = state;
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const lastSearchKeyRef = useRef<string>('');
  const runSearchRef = useRef<
    (overrideQuery?: string, options?: { force?: boolean }) => Promise<void>
  >(async () => {});

  const runSearch = useCallback(
    async (overrideQuery?: string, options?: { force?: boolean }) => {
      const queryText = (overrideQuery ?? query).trim();
      if (!queryText) return;

      const rawToolName = (toolName || '').trim();
      const normalizedToolName = rawToolName.startsWith('mcp_') ? rawToolName.slice(4) : rawToolName;
      if (!normalizedToolName) {
        setError('Memory tool not configured');
        setStatus('error');
        return;
      }

      const key = `${normalizedToolName}:${queryText}:${target.collection || ''}:${target.index || ''}:${target.namespace || ''}`;
      if (!options?.force && lastSearchKeyRef.current === key && status !== 'error') return;

      const ready = await waitForMcpReady(200);
      if (!ready) {
        setError('MCP is not ready');
        setStatus('error');
        return;
      }

      setStatus('searching');
      setError(null);
      try {
        const payload = buildMemoryQueryPayload(normalizedToolName, queryText, target);
        const result = await (window as any).callMcpTool?.(normalizedToolName, payload);
        const hits = normalizeMemoryRecallResults(result).slice(0, 12);
        onUpdate(hits, Date.now());
        lastSearchKeyRef.current = key;
        setStatus('idle');
      } catch (err: any) {
        console.warn('[MemoryRecallWidget] MCP search failed', err);
        setError(err?.message || 'Search failed');
        setStatus('error');
      }
    },
    [onUpdate, query, status, target, toolName],
  );

  useEffect(() => {
    runSearchRef.current = runSearch;
  }, [runSearch]);

  return { error, status, runSearch, runSearchRef, lastSearchKeyRef };
}
