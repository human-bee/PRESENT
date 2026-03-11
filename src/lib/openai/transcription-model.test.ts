import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  normalizeOpenAiTranscriptionModel,
} from './transcription-model';

describe('normalizeOpenAiTranscriptionModel', () => {
  it('maps deprecated mini transcription aliases to realtime-compatible names', () => {
    expect(normalizeOpenAiTranscriptionModel('gpt-4o-mini-transcription')).toBe(
      'gpt-4o-mini-transcribe',
    );
    expect(normalizeOpenAiTranscriptionModel('gpt-4o-transcription')).toBe(
      'gpt-4o-transcribe',
    );
  });

  it('preserves supported model ids and falls back for empty input', () => {
    expect(normalizeOpenAiTranscriptionModel('gpt-4o-mini-transcribe-2025-03-20')).toBe(
      'gpt-4o-mini-transcribe-2025-03-20',
    );
    expect(normalizeOpenAiTranscriptionModel('')).toBe(DEFAULT_OPENAI_TRANSCRIPTION_MODEL);
    expect(normalizeOpenAiTranscriptionModel(undefined, 'whisper-1')).toBe('whisper-1');
  });
});
