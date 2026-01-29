import type { ContextDocument } from '@/lib/stores/context-store';
import type { MeetingSummaryState } from './meeting-summary-schema';

export const normalizeMeetingSummaryState = (input: Partial<MeetingSummaryState>): MeetingSummaryState => ({
  title: input.title?.trim() || 'Meeting Summary',
  summary: input.summary?.trim() || '',
  highlights: Array.isArray(input.highlights) ? input.highlights.filter(Boolean) : [],
  decisions: Array.isArray(input.decisions) ? input.decisions.filter(Boolean) : [],
  actionItems: Array.isArray(input.actionItems) ? input.actionItems.filter((item) => item?.task) : [],
  tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : [],
  sourceDocumentId: input.sourceDocumentId,
  crmToolName: input.crmToolName,
  memoryCollection: input.memoryCollection,
  memoryIndex: input.memoryIndex,
  memoryNamespace: input.memoryNamespace,
  autoSend: input.autoSend,
  lastUpdated: input.lastUpdated,
  contextProfile: input.contextProfile,
});

export const resolveMeetingSummaryDocument = (
  documents: ContextDocument[],
  sourceDocumentId?: string,
) => {
  if (sourceDocumentId) {
    return documents.find((doc) => doc.id === sourceDocumentId) || null;
  }
  const sorted = [...documents].sort((a, b) => b.timestamp - a.timestamp);
  return (
    sorted.find((doc) => doc.title.toLowerCase().includes('summary')) ||
    sorted.find((doc) => doc.content.toLowerCase().includes('# summary')) ||
    sorted[0] ||
    null
  );
};

export const formatMeetingSummaryTime = (timestamp?: number) => {
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
};
