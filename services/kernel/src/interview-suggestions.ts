import type * as Y from 'yjs';
import type { BriefSuggestion } from '@present/contracts/interviews';
import { readBrief, setBriefSource } from '@/lib/interviews/document';
import { InterviewError } from './interview-store';

export function applyBriefSuggestion(doc: Y.Doc, suggestion: BriefSuggestion) {
  const transcript = readBrief(doc).transcripts.find((item) => item.id === suggestion.transcriptId);
  if (!transcript || !transcript.text.includes(suggestion.quote)) {
    throw new InterviewError(409, 'The suggestion’s evidence is unavailable. Dismiss it and capture the detail again.');
  }
  const text = doc.getText(suggestion.field);
  const profile = ['location', 'experience', 'availability'].includes(suggestion.field);
  if (profile && text.length && text.toString() !== suggestion.text) {
    throw new InterviewError(409, 'This profile detail already has a value. Edit it together or dismiss this suggestion.');
  }
  if (!profile || !text.length) text.insert(text.length, `${text.length ? '\n\n' : ''}${suggestion.text}`);
  setBriefSource(doc, suggestion.field, {
    kind: 'conversation', label: `From ${transcript.speaker}`, quote: suggestion.quote,
    transcriptId: suggestion.transcriptId, statement: suggestion.text,
    questionId: suggestion.questionId, answerStatus: suggestion.answerStatus,
  });
}
