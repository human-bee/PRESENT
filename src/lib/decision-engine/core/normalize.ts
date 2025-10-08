import type { NormalizedTranscript } from './types';

export function normalizeTranscript(transcript: string): NormalizedTranscript {
  const trimmed = transcript.trim();
  const lower = trimmed.toLowerCase();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  return {
    raw: transcript,
    trimmed,
    lower,
    wordCount,
  };
}
