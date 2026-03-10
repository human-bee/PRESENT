import { DEFAULT_VOICE_REALTIME_MODEL, resolveVoiceRealtimeConfig } from '../config';

const envOf = (patch: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({
    ...patch,
  }) as NodeJS.ProcessEnv;

describe('voice-agent realtime config', () => {
  it('defaults the voice conversation model to explicit gpt-realtime-1.5', () => {
    const config = resolveVoiceRealtimeConfig(envOf({}));

    expect(config.resolvedRealtimeModel).toBe(DEFAULT_VOICE_REALTIME_MODEL);
  });

  it('prefers explicit voice realtime overrides and ignores legacy REALTIME_MODEL', () => {
    const fromLegacyOnly = resolveVoiceRealtimeConfig(
      envOf({
        REALTIME_MODEL: 'gpt-realtime',
      }),
    );
    expect(fromLegacyOnly.resolvedRealtimeModel).toBe(DEFAULT_VOICE_REALTIME_MODEL);

    const fromVoiceEnv = resolveVoiceRealtimeConfig(
      envOf({
        REALTIME_MODEL: 'gpt-realtime',
        VOICE_AGENT_REALTIME_MODEL: 'gpt-realtime-1.5',
      }),
    );
    expect(fromVoiceEnv.resolvedRealtimeModel).toBe('gpt-realtime-1.5');

    const fromOverride = resolveVoiceRealtimeConfig(
      envOf({
        VOICE_AGENT_REALTIME_MODEL: 'gpt-realtime',
      }),
      {
        realtimeModel: 'gpt-realtime-1.5',
      },
    );
    expect(fromOverride.resolvedRealtimeModel).toBe('gpt-realtime-1.5');
  });

  it('uses transcription defaults from AGENT_STT_* when voice-specific vars are absent', () => {
    const config = resolveVoiceRealtimeConfig(
      envOf({
        AGENT_STT_MODEL: 'gpt-4o-mini-transcribe',
        AGENT_STT_LANGUAGE: 'en',
      }),
    );

    expect(config.transcriptionEnabled).toBe(true);
    expect(config.inputAudioTranscription).toEqual({
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
    });
    expect(config.resolvedSttModel).toBe('gpt-4o-mini-transcribe');
  });

  it('parses server_vad tuning and disables create_response by default when mode is explicit', () => {
    const config = resolveVoiceRealtimeConfig(
      envOf({
        VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
        VOICE_AGENT_TRANSCRIPTION_ENABLED: 'true',
        VOICE_AGENT_TURN_DETECTION: 'server_vad',
        VOICE_AGENT_TURN_THRESHOLD: '0.7',
        VOICE_AGENT_TURN_PREFIX_PADDING_MS: '320',
        VOICE_AGENT_TURN_SILENCE_DURATION_MS: '580',
      }),
    );

    expect(config.turnDetectionOption).toEqual({
      type: 'server_vad',
      threshold: 0.7,
      prefix_padding_ms: 320,
      silence_duration_ms: 580,
      create_response: false,
    });
  });

  it('maps noisy_room mic profile to far_field noise reduction by default', () => {
    const config = resolveVoiceRealtimeConfig(
      envOf({
        VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
        VOICE_AGENT_TRANSCRIPTION_ENABLED: 'true',
        VOICE_AGENT_MIC_PROFILE: 'noisy_room',
      }),
    );

    expect(config.micProfile).toBe('noisy_room');
    expect(config.inputAudioNoiseReduction).toEqual({ type: 'far_field' });
  });

  it('supports explicit room noise cancellation module wiring and json options', () => {
    const config = resolveVoiceRealtimeConfig(
      envOf({
        VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
        VOICE_AGENT_TRANSCRIPTION_ENABLED: 'true',
        VOICE_AGENT_ROOM_NOISE_CANCELLATION_ENABLED: 'true',
        VOICE_AGENT_ROOM_NOISE_CANCELLATION_MODULE_ID: 'bvc',
        VOICE_AGENT_ROOM_NOISE_CANCELLATION_OPTIONS_JSON: '{"mode":"aggressive"}',
      }),
    );

    expect(config.roomNoiseCancellation).toEqual({
      moduleId: 'bvc',
      options: { mode: 'aggressive' },
    });
  });

  it('clamps participant and dedupe limits to safe ranges', () => {
    const config = resolveVoiceRealtimeConfig(
      envOf({
        VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
        VOICE_AGENT_TRANSCRIPTION_ENABLED: 'true',
        VOICE_AGENT_TRANSCRIPTION_MAX_PARTICIPANTS: '999',
        VOICE_AGENT_TRANSCRIPT_DEDUPE_MAX_ENTRIES: '1',
      }),
    );

    expect(config.transcriptionMaxParticipants).toBe(16);
    expect(config.transcriptDedupeMaxEntries).toBe(16);
  });
});
