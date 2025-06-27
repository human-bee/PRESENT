# Real-Time Sync Architecture (May 2025)

This document explains the **LiveKit bus + adapter** refactor that landed in PR XXX.
It replaces ad-hoc `publishData` / `useDataChannel` calls with a single, structured
event stream shared by every layer: voice agent, browser UI, Tambo threads and
canvas components.

---
## 1  Event Bus
`src/lib/livekit-bus.ts`

```ts
const bus = createLiveKitBus(room)

bus.send('tool_call', { ... })
bus.on('ui_update', (payload) => { ... })
```

* Wraps `room.localParticipant.publishData` / `useDataChannel`.
* All payloads are JSON objects and **must** include a `timestamp` field.
* Topics in active use:

| topic          | publisher(s)                   | consumer(s)                          | payload shape |
|----------------|--------------------------------|--------------------------------------|---------------|
| `transcription`| LiveTranscription, VoiceAgent  | LiveTranscription, VoiceAgent        | {text,…}      |
| `tool_call`    | VoiceAgent                     | ToolDispatcher                       | {…}           |
| `tool_result`  | ToolDispatcher                 | VoiceAgent                           | {…}           |
| `ui_update`    | CanvasSyncAdapter, VoiceAgent  | CanvasSyncAdapter                    | {componentId,patch,timestamp} |
| `thread_msg`   | ThreadSyncAdapter              | ThreadSyncAdapter                    | {threadId,message} |
| `state_ping`   | ToolDispatcher (15 s)          | everyone                             | {pendingToolCount,…} |
| `state_pong`   | LiveTranscription / Canvas ……  | ToolDispatcher (logs)                | {source,itemCount|lineCount} |

---
## 2  Adapters

| Adapter                | File                                   | Responsibilities |
|------------------------|----------------------------------------|------------------|
| **CanvasSyncAdapter**  | `components/CanvasSyncAdapter.tsx`     | • wrap a visual component<br/>• emit `ui_update` via `bus.send`<br/>• apply remote patches via `onRemotePatch`<br/>• answer `state_ping` with `state_pong` + `itemCount` |
| **LiveTranscription**  | `components/LiveTranscription.tsx`     | • publish demo or real ASR on `transcription`<br/>• forward remote lines to callback<br/>• answer `state_ping` with lineCount |
| **ThreadSyncAdapter**  | `components/ThreadSyncAdapter.tsx`     | • publish each local Tambo chat message on `thread_msg`<br/>• inject remote messages via `sendThreadMessage` |
| **ToolDispatcher**     | `components/tool-dispatcher.tsx`       | • listen for `tool_call` → execute<br/>• publish `tool_result` / `tool_error`<br/>• 15 s heartbeat `state_ping` & mismatch logging |

---
## 3  Dynamic Tool Execution

`ToolDispatcher.executeToolCall` now first checks `useTambo().toolRegistry`. If a
tool with that name exists *and* is not one of the 4 built-ins it runs:

```ts
result = await registryTool.execute(params)
publishToolResult(id,result)
```

This means adding a new MCP server instantly expands capabilities—no new `case`
statements required.

---
## 4  Wrapping Components

### TLDraw Canvas
`components/ui/tldraw-canvas.tsx`
```tsx
<CanvasSyncAdapter
  componentId={componentId}
  getItemCount={() => Object.keys(editor.store.getSnapshot().document.pages).length}
>
  <Tldraw … />
</CanvasSyncAdapter>
```

### Retro Timer
`components/ui/retro-timer.tsx`
```tsx
<CanvasSyncAdapter componentId={componentId} onRemotePatch={patch => {
  if ('seconds' in patch) setSeconds(patch.seconds)
  if ('isRunning' in patch) setIsRunning(patch.isRunning)
}}>
  …
</CanvasSyncAdapter>
```

Any patch of the form `{seconds:300}` sent over `ui_update` will update everyone.

---
## 5  Voice Agent `ui_update`

Inside `livekit-agent-worker.ts` after completing a function call:
```ts
room.localParticipant.publishData(
  new TextEncoder().encode(JSON.stringify({
    componentId: 'retro-timer',
    patch: { seconds: 300 },
    timestamp: Date.now(),
  })),
  { reliable: true, topic: 'ui_update' }
)
```

---
## 6  Heartbeat & Reconciliation

• Every 15 s ToolDispatcher broadcasts `state_ping`.
• Adapters reply with `state_pong` counts.
• Dispatcher logs deltas > 1; future work could trigger a resync request.

---
## 7  Migration Checklist for New Components

1. Give it a stable **componentId**.
2. Wrap JSX in `<CanvasSyncAdapter componentId=…>`.
3. Emit patches by dispatching:
   ```js
   window.dispatchEvent(new CustomEvent('tambo:canvasPatch',
     {detail:{componentId:'my-chart',patch:{filter:"Q2"}}}))
   ```
4. Handle incoming `patch` inside `onRemotePatch`.
5. Optionally implement `getItemCount` for heartbeat stats.

---
## 8  Compatibility with tldraw-sync

CanvasSyncAdapter operates at the React-state layer. tldraw-sync continues to
replicate the TLDraw store. If both send the same update it's idempotent; if
they diverge, latest `timestamp` wins (implement Lamport clocks if needed).

---
Happy syncing! 🎉 