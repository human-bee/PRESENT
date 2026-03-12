# Voice Agent Noisy-Room Tuning

This guide documents the runtime tuning path used by `src/lib/agents/realtime/voice-agent.ts`.

## Runtime Contract

- Config source: `src/lib/agents/realtime/voice-agent/config.ts`
- Runtime guards: `src/lib/agents/realtime/voice-agent/runtime-guards.ts`
- Realtime model wiring:
  - `modelTransport` (`realtime` | `responses_ws`)
  - `resolvedRealtimeModel` (adaptive profile aware)
  - `resolvedResponsesModel`
  - `inputAudioTranscription`
  - `inputAudioNoiseReduction`
  - `turnDetection`
- Session audio format is explicit:
  - input: 24kHz mono
  - output: 24kHz mono

## Primary Knobs

- `VOICE_AGENT_TRANSCRIPTION_ENABLED`
- `VOICE_AGENT_MODEL_TRANSPORT` (`realtime` | `responses_ws`)
- `VOICE_AGENT_RESPONSES_MODEL` (defaults to `gpt-audio-1.5`)
- `VOICE_AGENT_REALTIME_MODEL_STRATEGY` (`fixed` | `adaptive_profile`)
- `VOICE_AGENT_REALTIME_MODEL_PRIMARY`
- `VOICE_AGENT_REALTIME_MODEL_SECONDARY`
- `VOICE_AGENT_REALTIME_MODEL` (explicit override)
- `VOICE_AGENT_INPUT_TRANSCRIPTION_MODEL`
- `VOICE_AGENT_TRANSCRIPTION_LANGUAGE`
- `VOICE_AGENT_TURN_DETECTION`
- `VOICE_AGENT_MIC_PROFILE` (`near_field` | `far_field` | `noisy_room`)
- `VOICE_AGENT_INPUT_NOISE_REDUCTION` (`near_field` | `far_field` | `none`)
- `VOICE_AGENT_TRANSCRIPT_DEDUPE_WINDOW_MS`
- `VOICE_AGENT_TRANSCRIPT_DEDUPE_MAX_ENTRIES`
- `VOICE_AGENT_ACTIVE_RESPONSE_RECOVERY_MAX_ATTEMPTS`

## RoomIO Noise Cancellation (Cloud BVC-first, Fail-open)

The voice agent can request RoomIO input noise cancellation via:

- `VOICE_AGENT_ROOM_NOISE_CANCELLATION_ENABLED`
- `VOICE_AGENT_ROOM_NOISE_CANCELLATION_MODULE_ID`
- `VOICE_AGENT_ROOM_NOISE_CANCELLATION_OPTIONS_JSON`

If startup fails with the configured module, the agent retries startup without module noise cancellation.

## Important Notes

- Realtime STT remains the primary strategy.
- Heavy DSP is not enabled by default in this path.
- `VOICE_AGENT_TRANSCRIPTION_MODE` is deprecated and has no runtime effect.
- `canvas_quick_apply` tool context/idempotency contracts are unchanged by tuning.
