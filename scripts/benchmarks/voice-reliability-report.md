# PRESENT voice reliability pass

Base: `375eb6c01e5cd5c340174559b2f6903e37862057` (combined native RoomOS).
No composition, access, assets, templates, work execution or meeting contracts changed. No live provider/microphone calls, push, merge or deployment.

## Implemented behavior

- A session-owning lifecycle detaches the exact old session synchronously. An old stop, fetch rejection, timer or drain cannot tear down a replacement. Explicit stop invalidates retry generations and wins while waiting for media, a timer or retirement. Identity changes share a retirement barrier in the hook.
- Transient peer disconnects have an 8-second grace period. Failure, channel close, setup timeout, transient session HTTP errors, heartbeat network failures and expired leases can start a fresh session. Retry delays are 500/1500/3500 ms; at most three automatic retries per explicit start, even after a successful recovery. Each start gets a fresh session ID and fresh event state. No tool request is retried or replayed by this client.
- Stop immediately quiesces dispatch, aborts tool/session/heartbeat requests and stops local microphone, mixed-output and received agent tracks. The audio mixer never stops supplied shared call-owned tracks. Graceful shutdown keeps only caption handling alive: session.close acknowledgement up to 3 seconds, final-caption drain up to 2 seconds, then ownership release HTTP up to 3 seconds. Fast disposal still attempts the bounded caption drain. Browser getUserMedia is not abortable; a late returned stream is immediately stopped. Page unload cannot guarantee delivery.
- Caption writes are serialized and independent of transport abort. Lease release follows the drain. Queue saturation/timeouts report that captions may be missing, rather than claiming durable delivery. New session setup first releases a remembered stale lease. UI transcripts and current editor getters survive automatic recovery; page/selection are freshly observed, not replayed as commands.
- Ordinary tool HTTP errors, including object conflicts (409) and missing/stale objects (410), return recoverable tool errors and leave the microphone alive. Heartbeat 410/network/5xx drives bounded recovery; heartbeat 409/auth failures are terminal. A completed remote mutation is never rolled back by local cancellation.

## Protocol evidence and deliberate limit

The existing `src/voice/realtime-events.ts` contract provides envelope `delegation_id`, nested `response.id`, and tool `call_id`. Existing fixtures use response.created, response.output_item.done and response.completed. The implementation keys responses by delegation + response ID, uses explicit nested response identity where supplied, and permits untagged calls only when the delegation is unambiguous. Same-delegation overlap permanently disables untagged fallback for affected responses, including late events after one response completes. Duplicate response.created cannot reset pending calls. Call-ID reuse with mismatched content/identity fails before another execution.

Outgoing `response.item.create` is correlated using its documented local `call_id`. The local code/fixtures provide only unscoped `response.create`; they do **not** establish an outbound response/delegation targeting field. Overlapping responses therefore receive their call-ID outputs but automatic continuation is withheld, with a diagnostic. No outbound targeting fields were invented. Coordinator needs verified GPT-Live protocol evidence before enabling targeted overlapping continuations. Normal non-overlapping continuation still runs once after all results.

## Required coordinator route hook

`VoiceOwnership.runTool` now supplies an owner cancellation signal, aborted on stop or lazy lease-expiry pruning. Existing zero-argument callbacks remain source compatible. For cooperative server cancellation, change only the voice-tool callback in coordinator-owned `server/agent-routes.ts`:

```ts
voiceOwnership.runTool(input, ownerSignal =>
  executeVoiceTool(input, AbortSignal.any([controller.signal, ownerSignal])))
```

This worker did not edit that route. Existing HTTP disconnect cancellation remains active without the hook; the hook additionally joins explicit lease stop/expiry to running work. It does not undo committed mutations, and tool implementations must observe the supplied signal. Keep the access worker's signed membership/actor binding. No other route wiring is needed.

## Timing and measured benchmark

Run: `node --import tsx scripts/benchmarks/voice-reliability.ts` (Node v24.19.0 in this cloud environment). Exact output is in `voice-reliability-results.json`. Workload is deterministic; wall-clock timings and GC are host-dependent.

40 sessions, 1,000 bursts, four tools per burst, 4,000 duplicate deliveries, including 520 overlapping bursts. Observed exactly 4,000 executions and 4,000 call-ID outputs. Non-overlapping bursts produced 480 continuations; 2,080 overlapping response continuations were deliberately withheld. No duplicate execution.

| Local measurement | p50 ms | p95 ms |
| --- | ---: | ---: |
| Synthetic speech-stop event receipt to tool dispatch | 0.013060 | 0.052104 |
| Synthetic speech-stop event receipt to tool result | 0.016833 | 0.063965 |
| Four-tool event burst processing | 0.025778 | 0.085221 |

These are local synthetic event/microtask timings, **not** acoustic speech-end, provider/model/network latency, or rendered latency. `input_audio_buffer.speech_stopped` is evidenced by the legacy `tests/live/native-voice.mjs` harness; GPT-Live is not assumed to emit it. Live caption input receipts use the explicitly labelled weaker `input-transcript-received` boundary. Neither boundary proves causal attribution to a human utterance. Missing boundaries omit elapsed time.

`exportVoiceTiming()` from `src/voice/timing.ts` (also re-exported by use-voice) returns frozen copies of the most recent 512 marks, tagged only by session/response/delegation/call IDs, phase, time and boundary kind. No transcript, prompt, arguments or result content is exported. No server endpoint or external telemetry is added.

Heap at start: 16,183,224 bytes; sampled event-loop peak: 23,911,064 bytes; end including server receipt exercise: 17,649,144 bytes. GC was not controlled; these are process samples, not a leak proof or a whole-process hard memory cap. The 1,000 server receipt fixture retained 163,890 encoded result bytes; stop reduced listener/call/result-byte counters to zero. Client close reduced all event cache counts to zero.

## Cache bounds

| State | Limit / behavior |
| --- | --- |
| Client call tombstones | 1,000; never evicted for replay; at most 1,048,576 total fingerprint characters |
| Client responses / caption event IDs | 2,000 / 8,000; capacity ends the session with a restart diagnostic |
| IDs / tool argument encoding | 100 / 65,536 characters |
| Caption groups / queued writes | 2 groups, at most 6,000 chars each / 128 writes |
| Timing marks | 512 across sessions |
| Server listeners / calls | 100 listeners globally, 24 personal listeners per room, 1,000 calls per listener |
| Encoded successful receipts | 256 KiB each, 4 MiB per listener, 32 MiB globally; immutable detached JSON snapshots |
| Failed receipts | Same call-count bound; compact errors capped at 2,000 message characters |

Oversized/uncacheable results retain a failure tombstone with an explicit instruction not to replay the action: execution may already have completed. The encoded receipt budgets exclude JS object overhead and transient execution/serialization memory. Session ceilings preserve deduplication rather than silently evicting mutating call IDs. No automatic session rotation is triggered by a capacity or ambiguous-protocol error.

## Validation

Focused fake-event/media/HTTP suite plus existing voice/context tests: 38 passed. Covers stop-before-start, delayed permission completion, old-stop/new-session disposal, retry exhaustion/cancellation, exact overlap correlation, late ambiguous events, duplicate handling, ordinary 409/410 tool results, heartbeat lease recovery, caption-before-release ordering, pending fetch abort, shared-track preservation, cache ceilings, immutable timing snapshots, server receipt failure replay and ownership cancellation. `npm run typecheck` passes. No opt-in live tests were run.

Commands:

```sh
node --import tsx --test tests/voice-reliability.test.ts tests/agent-voice.test.ts tests/agent-voice-ownership.test.ts tests/agent-voice-audio.test.ts tests/agent-canvas-context.test.ts tests/agent-voice-tools.test.ts
npm run typecheck
node --import tsx scripts/benchmarks/voice-reliability.ts
```
