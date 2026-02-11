import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';

/**
 * POST /api/transcribe
 *
 * Transcribes audio using OpenAI's Responses API (or fallback to Whisper)
 *
 * Request body:
 * - audio: string - Base64 encoded audio data (16-bit PCM)
 * - speaker: string - Name/identity of the speaker
 * - sampleRate: number - Audio sample rate (e.g., 48000)
 */
export async function POST(req: NextRequest) {
  try {
    const { audio, speaker, sampleRate } = await req.json();

    if (!audio) {
      return NextResponse.json({ error: 'Missing audio data' }, { status: 400 });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing OPENAI_API_KEY' },
        { status: 500 },
      );
    }

    // Convert base64 to binary
    const audioBuffer = Buffer.from(audio, 'base64');

    // For now, we'll use Whisper API as it's more straightforward for audio transcription
    // The Responses API is better suited for text-to-text tasks
    // In production, you might want to use Groq's Whisper for faster transcription

    try {
      // Create a temporary WAV file format in memory
      const wavBuffer = createWavBuffer(audioBuffer, sampleRate);

      // Create form data for Whisper API
      const formData = new FormData();
      // BlobPart typing in TS doesn't accept Node's Buffer cleanly (ArrayBufferLike).
      // Copy into a Uint8Array backed by a plain ArrayBuffer to keep DOM typings happy.
      const wavBytes = new Uint8Array(wavBuffer);
      const audioBlob = new Blob([wavBytes], { type: 'audio/wav' });
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en'); // You can make this configurable

      // Call OpenAI Whisper API
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Whisper API error:', error);
        throw new Error(`Transcription failed: ${response.status}`);
      }

      const data = await response.json();

      return NextResponse.json({
        success: true,
        transcription: data.text,
        speaker,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Transcription processing error:', error);

      // Fallback: Use the Responses API for a simpler approach
      // Note: This is a conceptual fallback - Responses API doesn't directly handle audio
      // In production, you'd use a proper speech-to-text service

      return NextResponse.json({
        success: false,
        error: 'Transcription failed',
        fallback: true,
        // Return a placeholder for testing
        transcription: '[Audio transcription placeholder - implement Groq Whisper or similar]',
        speaker,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

/**
 * Creates a WAV file buffer from PCM audio data
 */
function createWavBuffer(pcmData: Buffer, sampleRate: number): Buffer {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;

  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  pcmData.copy(buffer, 44);

  return buffer;
}
