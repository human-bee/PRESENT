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
- For true audio-based STT, wire a TTS audio publisher to LiveKit and enable transcription for that track.
