const TRANSCRIPTION_MODEL_ALIASES: Record<string, string> = {
  'gpt-4o-mini-transcription': 'gpt-4o-mini-transcribe',
  'gpt-4o-transcription': 'gpt-4o-transcribe',
};

export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

export function normalizeOpenAiTranscriptionModel(
  value: unknown,
  fallback = DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return TRANSCRIPTION_MODEL_ALIASES[trimmed] || trimmed;
}
