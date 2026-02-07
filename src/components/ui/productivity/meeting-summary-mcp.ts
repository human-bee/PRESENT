import { useCallback, useEffect, useRef, useState } from 'react';
import { waitForMcpReady } from '@/lib/mcp-bridge';
import { buildMemoryPayload } from '@/lib/mcp/memory';
import type { MeetingSummaryState } from './meeting-summary-schema';

type UseMeetingSummaryMcpArgs = {
  messageId: string;
  contextKey?: string;
  resolvedTitle: string;
  resolvedContent: string;
  state: MeetingSummaryState;
};

export function useMeetingSummaryMcp({
  messageId,
  contextKey,
  resolvedTitle,
  resolvedContent,
  state,
}: UseMeetingSummaryMcpArgs) {
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [mcpReady, setMcpReady] = useState(false);
  const lastAutoSentRef = useRef<string>('');

  const sendToCrm = useCallback(async (): Promise<boolean> => {
    const rawToolName = state.crmToolName?.trim() || '';
    const toolName = rawToolName.startsWith('mcp_') ? rawToolName.slice(4) : rawToolName;
    if (!toolName) {
      setSendState('error');
      setTimeout(() => setSendState('idle'), 1500);
      return false;
    }
    setSendState('sending');
    try {
      const envelope = {
        id: messageId,
        title: resolvedTitle,
        content: resolvedContent,
        summary: state.summary || resolvedContent,
        highlights: state.highlights,
        decisions: state.decisions,
        actionItems: state.actionItems,
        tags: state.tags,
        sourceDocumentId: state.sourceDocumentId,
        contextProfile: state.contextProfile,
        contextKey,
        messageId,
        lastUpdated: state.lastUpdated,
      };
      const target = {
        collection: state.memoryCollection,
        index: state.memoryIndex,
        namespace: state.memoryNamespace,
      };
      const payload = buildMemoryPayload(toolName, envelope, target);
      const result = await (window as any).callMcpTool?.(toolName, payload);
      if (!result) {
        throw new Error('mcp_tool_unavailable');
      }
      setSendState('sent');
      setTimeout(() => setSendState('idle'), 2000);
      return true;
    } catch {
      setSendState('error');
      setTimeout(() => setSendState('idle'), 2000);
      return false;
    }
  }, [contextKey, messageId, resolvedContent, resolvedTitle, state]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const ready = await waitForMcpReady(200);
      if (!active) return;
      if (ready) {
        setMcpReady(true);
        return;
      }
      if (typeof window === 'undefined') return;
      const promise = window.__mcp_ready_promise;
      if (promise) {
        promise.then(() => {
          if (active) setMcpReady(true);
        });
      } else {
        setMcpReady(true);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state.autoSend) return;
    if (!mcpReady) return;
    if (!state.crmToolName) return;
    if (!resolvedContent) return;
    const key = `${state.sourceDocumentId || 'summary'}-${state.lastUpdated || ''}-${resolvedContent.length}`;
    if (lastAutoSentRef.current === key) return;
    let cancelled = false;
    const run = async () => {
      const ok = await sendToCrm();
      if (!cancelled && ok) {
        lastAutoSentRef.current = key;
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    mcpReady,
    resolvedContent,
    sendToCrm,
    state.autoSend,
    state.crmToolName,
    state.lastUpdated,
    state.sourceDocumentId,
  ]);

  return { sendState, sendToCrm, mcpReady };
}
