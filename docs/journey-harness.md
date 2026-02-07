# Journey Harness (Multi-user + Supabase Traces)

This harness simulates a multi-user call, logs **tool calls**, **MCP usage**, **assets**, and **utterances** into Supabase, and generates an HTML report.

## 1) Start the stack

```bash
npm run stack:start
```

## 2) Run a multi-user script (synthetic STT)

This sends transcription events into LiveKit (topic: `transcription`) so the voice agent ingests them as **manual STT**.

```bash
npm run journey:run -- --room canvas-journey-demo
```

Optional:

- `--run <runId>` to set a specific run id.
- `--script <path>` to use a custom JSON script.

Default script: `scripts/journey/sample-script.json`.

## 2b) Run a multi-user script with TTS audio

This publishes **real audio** into LiveKit and lets the voice agent ingest it via STT.
Requires LiveKit credentials and an ElevenLabs API key.

```bash
export LIVEKIT_URL=ws://localhost:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=devsecret
export ELEVENLABS_API_KEY=...
export ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

npm run journey:tts -- --room canvas-journey-demo
```

Optional:

- `--manual true` or `JOURNEY_TTS_MANUAL=true` to also broadcast manual transcriptions.
- `JOURNEY_TTS_SAMPLE_RATE=16000` (default)
- `JOURNEY_TTS_FRAME_MS=20` (default)

## 3) Capture a report from Supabase

```bash
npm run journey:report -- <runId> docs/scrapbooks/<runId>-journey.html
```

## 4) Enable in-browser logging

Open the canvas with a run id:

```
http://localhost:3000/canvas?room=canvas-journey-demo&journeyRunId=<runId>&journeyLog=1
```

This captures:
- tool_call/tool_result/tool_error (from LiveKit data channel)
- MCP calls/results (from MCP bridge + MCP Apps)
- UI mount events (component lifecycle)

## Notes

- This is **synthetic STT**: we send transcription data packets rather than audio. It exercises the exact same voice-agent path.
- For true audio-based STT, use `npm run journey:tts` to publish TTS audio into LiveKit.
