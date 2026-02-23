import type { NoiseCancellationOptions } from '@livekit/rtc-node';

export type MicProfile = 'near_field' | 'far_field' | 'noisy_room';

export type RealtimeNoiseReductionOption = {
  type: 'near_field' | 'far_field';
};

export type RealtimeTurnDetectionOption =
  | {
      type: 'semantic_vad';
      eagerness?: 'auto' | 'low' | 'medium' | 'high';
      create_response?: boolean;
      interrupt_response?: boolean;
    }
  | {
      type: 'server_vad';
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
      create_response?: boolean;
      interrupt_response?: boolean;
    };

export type VoiceRealtimeConfig = {
  micProfile: MicProfile;
  transcriptionEnabled: boolean;
  multiParticipantTranscriptionEnabled: boolean;
  resolvedSttModel: string;
  resolvedTranscriptionLanguage: string;
  inputAudioTranscription: {
    model: string;
    language?: string;
  } | null;
  inputAudioNoiseReduction: RealtimeNoiseReductionOption | null | undefined;
  turnDetectionOption: RealtimeTurnDetectionOption | null | undefined;
  transcriptionMaxParticipants: number;
  replyTimeoutMs: number;
  interruptTimeoutMs: number;
  transcriptionReadyTimeoutMs: number;
  activeResponseRecoveryMaxAttempts: number;
  transcriptDedupeWindowMs: number;
  transcriptDedupeMaxEntries: number;
  inputAudioSampleRate: number;
  inputAudioNumChannels: number;
  outputAudioSampleRate: number;
  outputAudioNumChannels: number;
  roomNoiseCancellation: NoiseCancellationOptions | undefined;
};

const ROOM_AUDIO_SAMPLE_RATE = 24_000;
const ROOM_AUDIO_NUM_CHANNELS = 1;

const parseBoolean = (value?: string | null): boolean | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

const parsePositiveInt = (
  value: unknown,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number => {
  const parsed =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const next = Math.floor(parsed);
  if (next < min) return min;
  if (next > max) return max;
  return next;
};

const parseOptionalFloat = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
};

const parseOptionalJsonObject = (value?: string | null): Record<string, unknown> => {
  if (!value || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const parseMicProfile = (value?: string | null): MicProfile => {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'near_field') return 'near_field';
  if (normalized === 'far_field') return 'far_field';
  if (normalized === 'noisy_room') return 'noisy_room';
  return 'noisy_room';
};

const resolveNoiseReduction = ({
  explicitValue,
  micProfile,
}: {
  explicitValue?: string | null;
  micProfile: MicProfile;
}): RealtimeNoiseReductionOption | null | undefined => {
  const normalized = (explicitValue || '').trim().toLowerCase();
  if (normalized === 'none') return null;
  if (normalized === 'near_field') return { type: 'near_field' };
  if (normalized === 'far_field') return { type: 'far_field' };

  if (micProfile === 'near_field') return { type: 'near_field' };
  if (micProfile === 'far_field') return { type: 'far_field' };
  return { type: 'far_field' };
};

const resolveTurnDetection = ({
  transcriptionEnabled,
  mode,
  env,
}: {
  transcriptionEnabled: boolean;
  mode?: string | null;
  env: NodeJS.ProcessEnv;
}): RealtimeTurnDetectionOption | null | undefined => {
  if (!transcriptionEnabled) return null;
  const normalizedMode = (mode || '').trim().toLowerCase();
  if (!normalizedMode) return undefined;
  if (normalizedMode === 'none') return null;

  const createResponse = parseBoolean(env.VOICE_AGENT_TURN_CREATE_RESPONSE);
  const interruptResponse = parseBoolean(env.VOICE_AGENT_TURN_INTERRUPT_RESPONSE);

  if (normalizedMode === 'semantic_vad') {
    const eagernessRaw = (env.VOICE_AGENT_SEMANTIC_VAD_EAGERNESS || '').trim().toLowerCase();
    const eagerness =
      eagernessRaw === 'auto' ||
      eagernessRaw === 'low' ||
      eagernessRaw === 'medium' ||
      eagernessRaw === 'high'
        ? eagernessRaw
        : undefined;

    return {
      type: 'semantic_vad',
      ...(eagerness ? { eagerness } : {}),
      ...(typeof createResponse === 'boolean'
        ? { create_response: createResponse }
        : { create_response: false }),
      ...(typeof interruptResponse === 'boolean' ? { interrupt_response: interruptResponse } : {}),
    };
  }

  if (normalizedMode === 'server_vad') {
    const threshold = parseOptionalFloat(env.VOICE_AGENT_TURN_THRESHOLD);
    const prefixPaddingMs = parsePositiveInt(env.VOICE_AGENT_TURN_PREFIX_PADDING_MS, 0, 0, 5_000);
    const silenceDurationMs = parsePositiveInt(
      env.VOICE_AGENT_TURN_SILENCE_DURATION_MS,
      0,
      0,
      5_000,
    );

    return {
      type: 'server_vad',
      ...(typeof threshold === 'number' ? { threshold } : {}),
      ...(prefixPaddingMs > 0 ? { prefix_padding_ms: prefixPaddingMs } : {}),
      ...(silenceDurationMs > 0 ? { silence_duration_ms: silenceDurationMs } : {}),
      ...(typeof createResponse === 'boolean'
        ? { create_response: createResponse }
        : { create_response: false }),
      ...(typeof interruptResponse === 'boolean' ? { interrupt_response: interruptResponse } : {}),
    };
  }

  return undefined;
};

const resolveRoomNoiseCancellation = (
  env: NodeJS.ProcessEnv,
): NoiseCancellationOptions | undefined => {
  const enabled = parseBoolean(env.VOICE_AGENT_ROOM_NOISE_CANCELLATION_ENABLED) ?? true;
  if (!enabled) return undefined;

  const moduleId = (env.VOICE_AGENT_ROOM_NOISE_CANCELLATION_MODULE_ID || 'bvc').trim();
  if (!moduleId) return undefined;

  const options = parseOptionalJsonObject(env.VOICE_AGENT_ROOM_NOISE_CANCELLATION_OPTIONS_JSON);
  return { moduleId, options };
};

export const resolveVoiceRealtimeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): VoiceRealtimeConfig => {
  const envInputTranscriptionModel = env.VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL?.trim();
  const fallbackInputTranscriptionModel = env.AGENT_STT_MODEL?.trim();
  const envSttModel = env.VOICE_AGENT_STT_MODEL?.trim();
  const envTranscriptionLanguage = env.VOICE_AGENT_TRANSCRIPTION_LANGUAGE?.trim();
  const fallbackTranscriptionLanguage = env.AGENT_STT_LANGUAGE?.trim();
  const resolvedInputTranscriptionModel =
    envInputTranscriptionModel || fallbackInputTranscriptionModel || undefined;
  const resolvedSttModel =
    envSttModel || resolvedInputTranscriptionModel || 'gpt-4o-mini-transcribe';
  const transcriptionEnabledFlag = parseBoolean(env.VOICE_AGENT_TRANSCRIPTION_ENABLED);
  const multiParticipantTranscriptionEnabled =
    parseBoolean(env.VOICE_AGENT_MULTI_PARTICIPANT_TRANSCRIPTION) ?? false;
  const transcriptionEnabled =
    transcriptionEnabledFlag ??
    (!multiParticipantTranscriptionEnabled && Boolean(resolvedInputTranscriptionModel));
  const resolvedTranscriptionLanguage =
    envTranscriptionLanguage || fallbackTranscriptionLanguage || 'en';
  const inputAudioTranscription = transcriptionEnabled
    ? {
        model: resolvedSttModel,
        ...(resolvedTranscriptionLanguage ? { language: resolvedTranscriptionLanguage } : {}),
      }
    : null;

  const micProfile = parseMicProfile(env.VOICE_AGENT_MIC_PROFILE);
  const inputAudioNoiseReduction = resolveNoiseReduction({
    explicitValue: env.VOICE_AGENT_INPUT_NOISE_REDUCTION,
    micProfile,
  });
  const turnDetectionOption = resolveTurnDetection({
    transcriptionEnabled,
    mode: env.VOICE_AGENT_TURN_DETECTION,
    env,
  });
  const transcriptionMaxParticipants = parsePositiveInt(
    env.VOICE_AGENT_TRANSCRIPTION_MAX_PARTICIPANTS ?? env.VOICE_AGENT_TRANSCRIBER_MAX_PARTICIPANTS,
    8,
    1,
    16,
  );

  return {
    micProfile,
    transcriptionEnabled,
    multiParticipantTranscriptionEnabled,
    resolvedSttModel,
    resolvedTranscriptionLanguage,
    inputAudioTranscription,
    inputAudioNoiseReduction,
    turnDetectionOption,
    transcriptionMaxParticipants,
    replyTimeoutMs: parsePositiveInt(env.VOICE_AGENT_REPLY_TIMEOUT_MS, 8_000, 500, 60_000),
    interruptTimeoutMs: parsePositiveInt(env.VOICE_AGENT_INTERRUPT_TIMEOUT_MS, 1_500, 250, 30_000),
    transcriptionReadyTimeoutMs: parsePositiveInt(
      env.VOICE_AGENT_TRANSCRIPTION_READY_TIMEOUT_MS,
      10_000,
      1_000,
      60_000,
    ),
    activeResponseRecoveryMaxAttempts: parsePositiveInt(
      env.VOICE_AGENT_ACTIVE_RESPONSE_RECOVERY_MAX_ATTEMPTS,
      3,
      1,
      10,
    ),
    transcriptDedupeWindowMs: parsePositiveInt(
      env.VOICE_AGENT_TRANSCRIPT_DEDUPE_WINDOW_MS,
      2_500,
      250,
      30_000,
    ),
    transcriptDedupeMaxEntries: parsePositiveInt(
      env.VOICE_AGENT_TRANSCRIPT_DEDUPE_MAX_ENTRIES,
      256,
      16,
      4_096,
    ),
    inputAudioSampleRate: ROOM_AUDIO_SAMPLE_RATE,
    inputAudioNumChannels: ROOM_AUDIO_NUM_CHANNELS,
    outputAudioSampleRate: ROOM_AUDIO_SAMPLE_RATE,
    outputAudioNumChannels: ROOM_AUDIO_NUM_CHANNELS,
    roomNoiseCancellation: resolveRoomNoiseCancellation(env),
  };
};
