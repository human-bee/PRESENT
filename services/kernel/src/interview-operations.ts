import { z } from 'zod';
import * as Y from 'yjs';
import { briefSuggestionSchema, interviewTranscriptSchema, type BriefSuggestion } from '@present/contracts/interviews';
import { addBriefActivity, decodeState, readBrief, setBriefSource } from '@/lib/interviews/document';
import { applyBriefSuggestion } from './interview-suggestions';
import { assetMutationSchemas, applyAssetMutation } from './interview-assets';
import {
  accessInterview, InterviewError, interviewEnvelope, loadInterviewDocument, saveInterviewDocument,
} from './interview-store';

export const interviewMutationSchema = z.discriminatedUnion('action', [
  ...assetMutationSchemas,
  z.object({ action: z.literal('trace-rendered'), id: z.string().uuid(), widgets: z.array(z.enum(['guide', 'evidence', 'canvas'])).max(3).default([]) }),
  z.object({ action: z.literal('sync'), encodedState: z.string().min(1).max(900000) }),
  z.object({ action: z.literal('review'), revision: z.string().length(64) }),
  z.object({ action: z.literal('consent'), enabled: z.boolean() }),
  z.object({ action: z.literal('suggestion'), id: z.string().max(160), decision: z.enum(['accepted', 'dismissed']) }),
  z.object({ action: z.literal('note'), transcript: interviewTranscriptSchema }),
  z.object({ action: z.literal('quote'), transcriptId: z.string().max(160), field: briefSuggestionSchema.shape.field }),
]);

export function mutateInterview(id: string, token: string, mutation: z.infer<typeof interviewMutationSchema>) {
  return accessInterview(id, token, (record, role) => {
    const doc = loadInterviewDocument(record);
    try {
      if (mutation.action === 'sync') {
        try { Y.applyUpdate(doc, decodeState(mutation.encodedState)); }
        catch { throw new InterviewError(400, 'The document update is invalid.'); }
      } else if (mutation.action === 'trace-rendered') {
        const trace = record.pipeline?.find((item) => item.id === mutation.id);
        if (trace && trace.state === 'complete' && trace.savedAt) {
          trace.renderedAt ??= Date.now();
          (trace.renderedBy ??= {})[role] ??= Date.now();
          for (const widget of mutation.widgets) if (trace.widgetTargets.includes(widget)) {
            (trace.widgetObservedAt ??= {})[widget] ??= Date.now(); trace.widgetsAt ??= Date.now();
          }
        }
      } else if (mutation.action === 'asset-add' || mutation.action === 'asset-update' || mutation.action === 'asset-remove') {
        applyAssetMutation(doc, role, mutation);
      } else if (mutation.action === 'consent') {
        record.notesConsent[role] = mutation.enabled;
        addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} ${mutation.enabled ? 'enabled' : 'paused'} live notes.`);
      } else if (mutation.action === 'review') {
        if (record.revision !== mutation.revision) throw new InterviewError(409, 'The brief changed. Review the latest version first.');
        if (readBrief(doc).suggestions.some((item) => item.status === 'pending')) {
          throw new InterviewError(409, 'Accept or dismiss the remaining suggestions before approving.');
        }
        record.approvals[role] = record.revision;
        addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} approved this version of the handoff.`);
      } else if (mutation.action === 'note') {
        if (!doc.getMap('transcripts').has(mutation.transcript.id)) {
          doc.getMap('transcripts').set(mutation.transcript.id, mutation.transcript);
          addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} added a conversation note.`);
        }
      } else if (mutation.action === 'quote') {
        const transcript = readBrief(doc).transcripts.find((item) => item.id === mutation.transcriptId);
        if (!transcript) throw new InterviewError(404, 'Conversation note not found.');
        const text = doc.getText(mutation.field);
        text.insert(text.length, `${text.length ? '\n\n' : ''}“${transcript.text}”`);
        setBriefSource(doc, mutation.field, { kind: 'conversation', label: `From ${transcript.speaker}`, statement: `“${transcript.text}”`, quote: transcript.text, transcriptId: transcript.id });
        addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} added a conversation quote to the brief.`);
      } else {
        const suggestions = doc.getMap<BriefSuggestion>('suggestions');
        const suggestion = suggestions.get(mutation.id);
        if (!suggestion || suggestion.status !== 'pending') throw new InterviewError(409, 'This suggestion has already been reviewed.');
        if (mutation.decision === 'accepted') applyBriefSuggestion(doc, suggestion);
        suggestions.set(suggestion.id, { ...suggestion, status: mutation.decision });
        addBriefActivity(doc, `${role === 'candidate' ? 'Candidate' : 'Recruiter'} ${mutation.decision} a suggestion.`);
      }
      saveInterviewDocument(record, doc, role);
      return interviewEnvelope(record, role);
    } finally { doc.destroy(); }
  });
}
