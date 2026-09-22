import { z } from 'zod';
import type { TLRecord } from '@tldraw/tlschema';

export const transcriptEntrySchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(6000),
  at: z.number().finite(), source: z.literal('room-voice'),
});
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;
export const MAX_TRANSCRIPT_ENTRIES = 500;
export const MAX_TRANSCRIPT_BYTES = 256_000;
export type TranscriptWindow = { entries: TranscriptEntry[]; omitted: number };

/** Keep a contiguous newest window, counting UTF-8 JSON bytes including array punctuation. */
export function retainTranscript(entries: TranscriptEntry[]): TranscriptWindow {
  const encoder = new TextEncoder();
  let first = entries.length, bytes = 2;
  while (first > 0 && entries.length - first < MAX_TRANSCRIPT_ENTRIES) {
    const next = encoder.encode(JSON.stringify(entries[first - 1])).length + (first < entries.length ? 1 : 0);
    if (bytes + next > MAX_TRANSCRIPT_BYTES) break;
    bytes += next; first--;
  }
  return { entries: entries.slice(first), omitted: first };
}

export function readTranscriptWindow(records: TLRecord[]): TranscriptWindow {
  const doc = records.find(record => record.typeName === 'document');
  const present = doc?.meta.present;
  if (!present || typeof present !== 'object' || Array.isArray(present) || !Array.isArray(present.transcript)) return { entries: [], omitted: 0 };
  const entries = present.transcript.flatMap(entry => { const parsed = transcriptEntrySchema.safeParse(entry); return parsed.success ? [parsed.data] : []; });
  const window = retainTranscript(entries);
  const earlier = typeof present.transcriptOmitted === 'number' && Number.isSafeInteger(present.transcriptOmitted) && present.transcriptOmitted > 0 ? present.transcriptOmitted : 0;
  return { entries: window.entries, omitted: earlier + window.omitted + present.transcript.length - entries.length };
}
export function readTranscript(records: TLRecord[]): TranscriptEntry[] { return readTranscriptWindow(records).entries; }
