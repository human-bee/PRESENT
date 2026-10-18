import type { SpeechCreateParams } from 'openai/resources/audio/speech';

type SpeechClient = { audio: { speech: { create: (input: SpeechCreateParams) => PromiseLike<Response> } } };
export async function synthesizeInterviewSpeech(client: SpeechClient, text: string, role: 'candidate' | 'recruiter', model = 'gpt-4o-mini-tts') {
  if (!text.trim() || text.length > 4000) throw new Error('Use a nonempty source excerpt under 4,000 characters.');
  const voice = role === 'recruiter' ? 'marin' : 'cedar';
  const startedAt = performance.now();
  const response = await client.audio.speech.create({
    model,voice,input: text,response_format: 'pcm',stream_format: 'audio',speed: 1.08,
    instructions: `Read the supplied words exactly as a ${role} in a natural recruiting conversation. Warm, conversational and brisk. Use natural pauses and intonation. Do not add words or perform an exaggerated character.`,
  });
  if (!response.ok || !response.body) throw new Error('The speech service did not return audio.');
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let firstByteMs: number | undefined; let bytes = 0;
  try {
    while (true) {
      const { done,value } = await reader.read(); if (done) break;
      if (!value.byteLength) continue;
      firstByteMs ??= performance.now() - startedAt; bytes += value.byteLength;
      if (bytes > 24 * 1024 * 1024) throw new Error('The speech excerpt exceeded its audio limit.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const pcm = Buffer.concat(chunks);
  if (!pcm.length || pcm.length % 2) throw new Error('The speech service returned incomplete PCM audio.');
  return { pcm,voice,model,firstByteMs: firstByteMs!,completeMs: performance.now() - startedAt };
}
