import { NextRequest, NextResponse } from 'next/server';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';
export const runtime = 'nodejs';

const maxBodyBytes = Math.max(64_000, Number(process.env.TRANSCRIBE_MAX_BODY_BYTES ?? 3_000_000));
const maxAudioBytes = Math.max(8_000, Number(process.env.TRANSCRIBE_MAX_AUDIO_BYTES ?? 1_500_000));
const userRatePerMinute = Math.max(1, Number(process.env.TRANSCRIBE_RATE_LIMIT_PER_USER_PER_MIN ?? 20));
const transcribeBudgetPerMinute = Math.max(
  8_000,
  Number(process.env.COST_TRANSCRIBE_AUDIO_BYTES_PER_MINUTE_LIMIT ?? 24_000_000),
);
const REQUIRE_TRANSCRIBE_AUTH =
  (process.env.TRANSCRIBE_REQUIRE_AUTH ??
    (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';

const getTestUserId = (): string | null => {
  if (process.env.NODE_ENV !== 'test') return null;
  const raw = process.env.TEST_USER_ID?.trim();
  return raw || null;
};

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const testUser = getTestUserId();
  if (testUser) return testUser;
  const auth = await getRequestUserId(req);
  if (!auth.ok) return null;
  return auth.userId;
}

function deriveAnonymousFingerprint(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0]?.trim() || 'unknown-ip';
  const ua = req.headers.get('user-agent') || 'unknown-ua';
  return createHash('sha1').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
}

/**
 * POST /api/transcribe
 *
 * Request body:
 * - audio: Base64 encoded audio data (16-bit PCM)
 * - speaker: optional speaker label
 * - sampleRate: audio sample rate
 */
export async function POST(req: NextRequest) {
  try {
    const userId = REQUIRE_TRANSCRIBE_AUTH
      ? await resolveUserId(req)
      : getTestUserId() || `anonymous:${deriveAnonymousFingerprint(req)}`;
    if (REQUIRE_TRANSCRIBE_AUTH && !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const rate = consumeWindowedLimit(`transcribe:user:${userId}`, userRatePerMinute, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfterSec: rate.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
      );
    }

    const body = await req.json();
    const audio = typeof body?.audio === 'string' ? body.audio : '';
    const speaker = typeof body?.speaker === 'string' ? body.speaker : undefined;
    const sampleRate =
      typeof body?.sampleRate === 'number' && Number.isFinite(body.sampleRate)
        ? Math.max(8_000, Math.min(96_000, Math.floor(body.sampleRate)))
        : 48_000;

    if (!audio) {
      return NextResponse.json({ error: 'Missing audio data' }, { status: 400 });
    }

    let openaiApiKey: string | null = null;
    if (BYOK_ENABLED) {
      const userId = await resolveRequestUserId(req);
      if (!userId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      openaiApiKey = await getDecryptedUserModelKey({ userId, provider: 'openai' });
      if (!openaiApiKey) {
        return NextResponse.json({ error: 'BYOK_MISSING_KEY:openai' }, { status: 400 });
      }
    } else {
      openaiApiKey = process.env.OPENAI_API_KEY || null;
      if (!openaiApiKey) {
        return NextResponse.json(
          { error: 'Server misconfigured: missing OPENAI_API_KEY' },
          { status: 500 },
        );
      }
    }

    const audioBuffer = Buffer.from(audio, 'base64');
    if (audioBuffer.length > maxAudioBytes) {
      return NextResponse.json({ error: 'Audio payload too large' }, { status: 413 });
    }

    const wavBuffer = createWavBuffer(audioBuffer, sampleRate);
    const formData = new FormData();
    const wavBytes = new Uint8Array(wavBuffer);
    const audioBlob = new Blob([wavBytes], { type: 'audio/wav' });
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('[transcribe] upstream whisper error', {
        status: response.status,
        bodyPreview: errText.slice(0, 240),
      });
      return NextResponse.json(
        { error: 'Transcription failed upstream', status: response.status },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      transcription: data.text,
      speaker,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[transcribe] API error', error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

function createWavBuffer(pcmData: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmData.copy(buffer, 44);

  return buffer;
}
