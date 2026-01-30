import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { AccessToken } from 'livekit-server-sdk';
import { AudioFrame, AudioSource, LocalAudioTrack, Room } from '@livekit/rtc-node';
import { broadcastTranscription } from '@/lib/agents/shared/supabase-context';

type JourneyLine = {
  speaker: string;
  text: string;
  delayMs?: number;
};

type SpeakerSession = {
  room: Room;
  audioSource: AudioSource;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getArg = (name: string) => {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return '';
  return process.argv[idx + 1] || '';
};

const loadScript = (filePath: string): JourneyLine[] => {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Journey script must be a JSON array');
  }
  return parsed.map((entry) => ({
    speaker: String(entry?.speaker || 'user'),
    text: String(entry?.text || ''),
    delayMs: typeof entry?.delayMs === 'number' ? entry.delayMs : undefined,
  }));
};

const createSupabase = () => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
};

const logEvent = async (supabase: ReturnType<typeof createSupabase>, payload: Record<string, unknown>) => {
  if (!supabase) return;
  await supabase.from('present_journey_events').insert(payload);
};

const buildToken = (room: string, identity: string) => {
  const apiKey = process.env.LIVEKIT_API_KEY || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET || '';
  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required');
  }
  const token = new AccessToken(apiKey, apiSecret, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: true, canPublishData: true });
  return token.toJwt();
};

const ensureSpeakerSession = async (
  roomName: string,
  speaker: string,
  sampleRate: number,
): Promise<SpeakerSession> => {
  const livekitUrl = process.env.LIVEKIT_URL || process.env.LIVEKIT_WS_URL || '';
  if (!livekitUrl) {
    throw new Error('LIVEKIT_URL is required for TTS journey');
  }
  const room = new Room();
  await room.connect(livekitUrl, buildToken(roomName, speaker));
  const audioSource = new AudioSource(sampleRate, 1);
  const track = LocalAudioTrack.createAudioTrack(`tts-${speaker}`, audioSource);
  await room.localParticipant.publishTrack(track);
  return { room, audioSource };
};

const fetchElevenLabsPcm = async (text: string, sampleRate: number) => {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY missing');
  }
  const outputFormat = sampleRate === 16000 ? 'pcm_16000' : 'pcm_22050';
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.75,
          style: 0.55,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`ElevenLabs error: ${response.status} ${message}`);
  }
  const buffer = await response.arrayBuffer();
  return new Int16Array(buffer);
};

const pushPcmFrames = async (
  audioSource: AudioSource,
  pcm: Int16Array,
  sampleRate: number,
  frameMs: number,
) => {
  const frameSize = Math.floor((sampleRate * frameMs) / 1000);
  let offset = 0;
  while (offset < pcm.length) {
    const slice = pcm.subarray(offset, offset + frameSize);
    const frameBuffer = new Int16Array(frameSize);
    frameBuffer.set(slice);
    const frame = new AudioFrame({
      data: frameBuffer,
      sampleRate,
      channels: 1,
    });
    audioSource.captureFrame(frame);
    offset += frameSize;
    await sleep(frameMs);
  }
};

const main = async () => {
  const room = getArg('--room') || process.env.JOURNEY_ROOM || 'canvas-journey';
  const runId = getArg('--run') || process.env.JOURNEY_RUN_ID || randomUUID();
  const scriptArg = getArg('--script');
  const scriptPath =
    scriptArg ||
    path.join(process.cwd(), 'scripts', 'journey', 'sample-script.json');
  const manual =
    (getArg('--manual') || process.env.JOURNEY_TTS_MANUAL || '').toLowerCase() === 'true';
  const sampleRate = Number.parseInt(process.env.JOURNEY_TTS_SAMPLE_RATE || '16000', 10);
  const frameMs = Number.parseInt(process.env.JOURNEY_TTS_FRAME_MS || '20', 10);

  const lines = loadScript(scriptPath);
  const supabase = createSupabase();
  const sessions = new Map<string, SpeakerSession>();

  await logEvent(supabase, {
    run_id: runId,
    room_name: room,
    event_type: 'run_start',
    source: 'journey-tts',
    payload: { scriptPath, lineCount: lines.length },
  });

  for (const line of lines) {
    const delay = typeof line.delayMs === 'number' ? line.delayMs : 1200;
    await sleep(delay);
    const speaker = line.speaker || 'user';
    const text = line.text.trim();
    if (!text) continue;

    await logEvent(supabase, {
      run_id: runId,
      room_name: room,
      event_type: 'tts_call',
      source: speaker,
      payload: { text },
    });

    try {
      let session = sessions.get(speaker);
      if (!session) {
        session = await ensureSpeakerSession(room, speaker, sampleRate);
        sessions.set(speaker, session);
      }

      const start = Date.now();
      const pcm = await fetchElevenLabsPcm(text, sampleRate);
      await logEvent(supabase, {
        run_id: runId,
        room_name: room,
        event_type: 'tts_result',
        source: speaker,
        duration_ms: Date.now() - start,
        payload: { bytes: pcm.byteLength, sampleRate },
      });

      await pushPcmFrames(session.audioSource, pcm, sampleRate, frameMs);
      await logEvent(supabase, {
        run_id: runId,
        room_name: room,
        event_type: 'audio_publish',
        source: speaker,
        payload: { sampleRate, frameMs, text },
      });

      if (manual) {
        await broadcastTranscription({
          room,
          text,
          speaker,
          manual: true,
        });
        await logEvent(supabase, {
          run_id: runId,
          room_name: room,
          event_type: 'utterance',
          source: speaker,
          payload: { text, manual: true },
        });
      }
    } catch (error: any) {
      await logEvent(supabase, {
        run_id: runId,
        room_name: room,
        event_type: 'tts_error',
        source: speaker,
        payload: { message: error?.message || String(error) },
      });
      if (manual) {
        await broadcastTranscription({
          room,
          text,
          speaker,
          manual: true,
        });
      }
      console.warn('[Journey TTS] Failed to synthesize line', { speaker, error });
    }
  }

  for (const session of sessions.values()) {
    await session.room.disconnect();
  }

  await logEvent(supabase, {
    run_id: runId,
    room_name: room,
    event_type: 'run_end',
    source: 'journey-tts',
    payload: { lineCount: lines.length },
  });

  console.log(`[Journey TTS] Completed run ${runId} in room ${room}`);
};

main().catch((error) => {
  console.error('[Journey TTS] Failed to run TTS journey', error);
  process.exit(1);
});
