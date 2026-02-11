'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Send } from 'lucide-react';
import { Button } from '@/components/ui/shared/button';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import { useContextDocuments } from '@/lib/stores/context-store';
import { createMarkdownComponents } from '@/components/ui/shared/markdown-components';
import type { MeetingSummaryState, MeetingSummaryWidgetProps } from './meeting-summary-schema';
import { useMeetingSummaryMcp } from './meeting-summary-mcp';
import {
  ActionItemList,
  EmptySummaryState,
  SendStatus,
  SummaryList,
  SummaryTags,
} from './meeting-summary-sections';
import {
  formatMeetingSummaryTime,
  normalizeMeetingSummaryState,
  resolveMeetingSummaryDocument,
} from './meeting-summary-utils';
import { WidgetFrame } from './widget-frame';

export { meetingSummaryWidgetSchema } from './meeting-summary-schema';

export function MeetingSummaryWidget(props: MeetingSummaryWidgetProps) {
  const {
    __custom_message_id,
    messageId: propMessageId,
    contextKey,
    className,
    ...initial
  } = props;

  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `meeting-summary-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const [state, setState] = useState<MeetingSummaryState>(() => normalizeMeetingSummaryState(initial));
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const documents = useContextDocuments();

  const resolvedDocument = useMemo(
    () => resolveMeetingSummaryDocument(documents, state.sourceDocumentId),
    [documents, state.sourceDocumentId],
  );

  const resolvedTitle = state.title || resolvedDocument?.title || 'Meeting Summary';
  const resolvedContent = state.summary || resolvedDocument?.content || '';

  const applyPatch = useCallback((patch: Record<string, unknown>) => {
    setState((prev) => {
      const next: MeetingSummaryState = { ...prev };
      if (typeof patch.title === 'string') next.title = patch.title.trim() || prev.title;
      if (typeof patch.summary === 'string') next.summary = patch.summary.trim();
      if (Array.isArray(patch.highlights)) next.highlights = patch.highlights.filter(Boolean);
      if (Array.isArray(patch.decisions)) next.decisions = patch.decisions.filter(Boolean);
      if (Array.isArray(patch.actionItems)) {
        next.actionItems = patch.actionItems.filter((item: any) => item?.task);
      }
      if (Array.isArray(patch.tags)) next.tags = patch.tags.filter(Boolean);
      if (typeof patch.sourceDocumentId === 'string') next.sourceDocumentId = patch.sourceDocumentId;
      if (typeof patch.crmToolName === 'string') next.crmToolName = patch.crmToolName;
      if (typeof patch.memoryCollection === 'string') next.memoryCollection = patch.memoryCollection;
      if (typeof patch.memoryIndex === 'string') next.memoryIndex = patch.memoryIndex;
      if (typeof patch.memoryNamespace === 'string') next.memoryNamespace = patch.memoryNamespace;
      if (typeof patch.contextProfile === 'string') next.contextProfile = patch.contextProfile;
      if (typeof patch.lastUpdated === 'number') next.lastUpdated = patch.lastUpdated;
      if (typeof patch.autoSend === 'boolean') next.autoSend = patch.autoSend;
      return next;
    });
  }, []);

  const registryProps = useMemo(
    () => ({
      title: state.title,
      summary: state.summary,
      highlights: state.highlights,
      decisions: state.decisions,
      actionItems: state.actionItems,
      tags: state.tags,
      sourceDocumentId: state.sourceDocumentId,
      crmToolName: state.crmToolName,
      memoryCollection: state.memoryCollection,
      memoryIndex: state.memoryIndex,
      memoryNamespace: state.memoryNamespace,
      autoSend: state.autoSend,
      lastUpdated: state.lastUpdated,
      contextProfile: state.contextProfile,
      className,
    }),
    [className, state],
  );

  useComponentRegistration(
    messageId,
    'MeetingSummaryWidget',
    registryProps,
    contextKey || 'canvas',
    applyPatch,
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resolvedContent || '');
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  }, [resolvedContent]);

  const { sendState, sendToCrm } = useMeetingSummaryMcp({
    messageId,
    contextKey,
    resolvedTitle,
    resolvedContent,
    state,
  });

  const lastUpdatedLabel = formatMeetingSummaryTime(state.lastUpdated ?? resolvedDocument?.timestamp);

  return (
    <WidgetFrame
      title={resolvedTitle}
      subtitle={state.contextProfile ? `Profile: ${state.contextProfile}` : undefined}
      meta={lastUpdatedLabel ? `Updated ${lastUpdatedLabel}` : undefined}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="mr-1 h-4 w-4" />
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            disabled={!state.crmToolName || sendState === 'sending'}
            loading={sendState === 'sending'}
            onClick={sendToCrm}
          >
            <Send className="mr-1 h-4 w-4" />
            Send
          </Button>
        </>
      }
      className={className}
      bodyClassName="space-y-4"
    >

      <SummaryTags tags={state.tags} />

      {resolvedContent && (
        <section>
          <h3 className="text-sm font-semibold text-secondary">Summary</h3>
          <div className="mt-2 text-sm text-primary break-words whitespace-pre-wrap">
            <ReactMarkdown components={createMarkdownComponents()}>
              {resolvedContent}
            </ReactMarkdown>
          </div>
        </section>
      )}

      <SummaryList title="Highlights" items={state.highlights} />
      <SummaryList title="Decisions" items={state.decisions} />
      <ActionItemList items={state.actionItems} />
      {!resolvedContent && <EmptySummaryState />}

      <SendStatus state={sendState} />
    </WidgetFrame>
  );
}

export default MeetingSummaryWidget;
