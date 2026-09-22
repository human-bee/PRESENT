import { createHash } from 'node:crypto';
import type { TLDocument } from '@tldraw/tlschema';
import { readTranscriptWindow, retainTranscript, transcriptEntrySchema } from '../../shared/transcript';
import { transactCanvas } from '../room-store';
import { AgentError } from './contract';

/** Final captions are room data in the same native document; never infer speakers from a mixed track. */
export function createAppendTranscript(commit: typeof transactCanvas = transactCanvas) {
  return (roomId: string, actor: string, sessionId: string, raw: unknown) => {
  const parsed = transcriptEntrySchema.omit({ at: true, source: true }).safeParse(raw);
  if (!parsed.success) throw new AgentError('Invalid final transcript.', 400);
  const entry = { ...parsed.data, at: Date.now(), source: 'room-voice' as const };
  const requestId = `transcript:${createHash('sha256').update(`${sessionId}:${entry.id}`).digest('hex')}`;
  commit(roomId, { ...entry, at: 0 }, actor, records => {
    const document = records.find((record): record is TLDocument => record.typeName === 'document');
    if (!document) throw new AgentError('The room document is unavailable.', 404);
    const present = document.meta.present && typeof document.meta.present === 'object' && !Array.isArray(document.meta.present) ? document.meta.present : {};
    const transcript = readTranscriptWindow(records);
    const existing = transcript.entries.find(item => item.id === entry.id);
    if (existing && (existing.text !== entry.text || existing.role !== entry.role)) throw new AgentError('This transcript item already has different final text.', 409);
    const retained = retainTranscript([...transcript.entries, entry]);
    return existing ? {} : { documentMeta: { present: { ...present, transcript: retained.entries, transcriptOmitted: transcript.omitted + retained.omitted } } };
  }, { requestId });
  return { saved: true, id: entry.id };
  };
}
export const appendTranscript = createAppendTranscript();
