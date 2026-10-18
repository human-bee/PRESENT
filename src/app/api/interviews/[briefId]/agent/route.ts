import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { accessInterview, InterviewError, interviewEnvelope, loadInterviewDocument, saveInterviewDocument } from '@present/kernel/interview-store';
import { readBrief, addBriefActivity } from '@/lib/interviews/document';
import { suggestFromTranscript } from '@/lib/interviews/agent';
import { consumeWindowedLimit } from '@/lib/server/traffic-guards';
import { applyBriefSuggestion } from '@present/kernel/interview-suggestions';
import { interviewRequest, interviewToken, privateJson } from '../../http';

export const runtime = 'nodejs';
const inputSchema = z.object({ transcriptId: z.string().min(1).max(160), draft: z.boolean().default(false) });
export async function POST(request: Request, context: { params: Promise<{ briefId: string }> }) {
  return interviewRequest(async () => {
    const { briefId } = await context.params;
    const token = interviewToken(request);
    const { transcriptId, draft } = inputSchema.parse(await request.json());
    const input = await accessInterview(briefId, token, (record, role) => {
      if (role !== 'recruiter') throw new InterviewError(403, 'The recruiter runs the shared listening agent.');
      if (!record.notesConsent.candidate || !record.notesConsent.recruiter) throw new InterviewError(409, 'Both people must enable live notes first.');
      if (!process.env.OPENAI_API_KEY) throw new InterviewError(503, 'The listening agent is not connected to OpenAI yet.');
      const previous = record.processed[transcriptId];
      if (previous && (previous.complete || Date.now() - previous.startedAt < 30000)) return null;
      // Server VAD may split one spoken answer into several final utterances.
      if (Object.values(record.processed).filter((item) => Date.now() - item.startedAt < 60000).length >= 45) {
        throw new InterviewError(429, 'The agent is catching up. Try this note again shortly.');
      }
      if (!consumeWindowedLimit('open-brief:model', 60, 60000).ok) throw new InterviewError(429, 'The listening agent is busy. Your note is saved; try again shortly.');
      const doc = loadInterviewDocument(record);
      try {
        const snapshot = readBrief(doc);
        const transcript = snapshot.transcripts.find((item) => item.id === transcriptId);
        if (!transcript) throw new InterviewError(404, 'Conversation note not found.');
        record.processed[transcriptId] = { startedAt: Date.now(), complete: false };
        const traceId = randomUUID();
        record.pipeline = [...(record.pipeline ?? []).slice(-39), {
          id: traceId, transcriptId, origin: transcript.origin === 'live' ? 'live' : transcript.origin === 'audio-replay' ? 'audio-test' : 'manual',
          input: transcript.text, model: process.env.INTERVIEW_AGENT_MODEL || 'gpt-4.1-mini', state: 'running', receivedAt: Date.now(),
          speechEndedAt: transcript.audioTiming?.speechEndedAt, transcribedAt: transcript.audioTiming?.transcribedAt,
          speechGeneration: transcript.audioTiming?.generation,
          decisionStartedAt: Date.now(), patches: [], widgetTargets: [],
        }];
        return { snapshot, transcript, traceId };
      } finally { doc.destroy(); }
    });
    if (!input) return privateJson({ skipped: true });
    try {
      const suggestions = await suggestFromTranscript(input.snapshot, input.transcript);
      const decisionCompletedAt = Date.now();
      const interview = await accessInterview(briefId, token, (record, role) => {
        const doc = loadInterviewDocument(record);
        const trace = record.pipeline?.find((item) => item.id === input.traceId);
        try {
          if (record.notesConsent.candidate && record.notesConsent.recruiter) {
            for (const suggestion of suggestions) {
              let status: 'pending' | 'accepted' | 'dismissed' = suggestion.status;
              if (draft) {
                try { applyBriefSuggestion(doc, suggestion); status = 'accepted'; }
                catch (error) { if (!(error instanceof InterviewError) || error.status !== 409) throw error; }
              }
              doc.getMap('suggestions').set(suggestion.id, { ...suggestion, status });
              trace?.patches.push({ field: suggestion.field, text: suggestion.text, accepted: status === 'accepted' });
            }
            if (suggestions.length) addBriefActivity(doc, 'The listening agent proposed transcript-backed additions.');
            record.processed[transcriptId] = { startedAt: Date.now(), complete: true };
            if (trace) {
              trace.decisionCompletedAt = decisionCompletedAt; trace.validatedAt = Date.now(); trace.state = 'complete';
              if (trace.patches.some((patch) => patch.accepted)) trace.widgetTargets = ['guide', 'evidence'];
              if (trace.patches.some((patch) => patch.accepted && ['work','aiWork'].includes(patch.field))) trace.widgetTargets.push('canvas');
            }
          } else { delete record.processed[transcriptId]; if (trace) trace.state = 'paused'; }
          saveInterviewDocument(record, doc, 'agent');
          if (trace?.state === 'complete') trace.savedAt = Date.now();
          return interviewEnvelope(record, role);
        } finally { doc.destroy(); }
      });
      return privateJson({ interview });
    } catch {
      await accessInterview(briefId, token, (record) => {
        delete record.processed[transcriptId];
        const trace = record.pipeline?.find((item) => item.id === input.traceId); if (trace) trace.state = 'failed';
      });
      throw new InterviewError(502, 'The agent could not process this note. Your note is saved; you can retry it.');
    }
  });
}
