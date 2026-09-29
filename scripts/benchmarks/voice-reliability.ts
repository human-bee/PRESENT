/** Deterministic, provider-free workload. Wall-clock timings vary with the host. */
import { performance } from 'node:perf_hooks';
import { createRealtimeEvents, VOICE_EVENT_LIMITS, type RealtimeEnvelope } from '../../src/voice/realtime-events';
import { createVoiceTiming, VOICE_TIMING_LIMIT } from '../../src/voice/timing';
import { VoiceOwnership, VOICE_OWNERSHIP_LIMITS } from '../../server/agents/voice-ownership';

const percentile = (values: number[], quantile: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] ?? 0;
const distribution = (values: number[]) => ({ count: values.length, p50Ms: +percentile(values, 0.5).toFixed(6), p95Ms: +percentile(values, 0.95).toFixed(6) });
const dispatch: number[] = [], result: number[] = [], bursts: number[] = [];
let executions = 0, outputs = 0, continuations = 0, warnings = 0, peakHeap = process.memoryUsage().heapUsed;
let peak = { calls: 0, responses: 0, captions: 0, fingerprintChars: 0 };
const startHeap = process.memoryUsage().heapUsed, started = performance.now();
const wrap = (delegation: string, event: RealtimeEnvelope['event']): RealtimeEnvelope => ({ type: 'response.event', delegation_id: delegation, event });
for (let session = 0; session < 40; session++) {
  const timing = createVoiceTiming();
  const events = createRealtimeEvents({ sessionId: `bench-${session}`, timing, current: () => true, mode: () => 'ambient', status: () => {}, record: () => {}, error: error => { throw error; }, warning: () => { warnings++; },
    execute: async () => { executions++; await Promise.resolve(); return { objectId: 'fixture-result', ok: true }; },
    send: value => { if ((value as { type: string }).type === 'response.create') continuations++; else outputs++; },
  });
  for (let burst = 0; burst < 25; burst++) {
    const start = performance.now();
    // Legacy provider speech-end receipt is an observed protocol fixture. These
    // numbers do not measure microphone speech end, network, model or browser paint.
    await events({ type: 'input_audio_buffer.speech_stopped' });
    const overlapping = burst % 2 === 0;
    for (let lane = 0; lane < (overlapping ? 4 : 1); lane++) await events(wrap(`d${lane}`, { type: 'response.created', response: { id: `r${burst}-${lane}` } }));
    const done: Promise<void>[] = [];
    for (let lane = 0; lane < 4; lane++) {
      const d = `d${overlapping ? lane : 0}`, r = `r${burst}-${overlapping ? lane : 0}`;
      const event = wrap(d, { type: 'response.output_item.done', response: { id: r }, item: { type: 'function_call', call_id: `call${burst}-${lane}`, name: 'add_note', arguments: '{"text":"fixture"}' } });
      await events(event); await events(event); // deterministic duplicate delivery
      if (overlapping || lane === 3) done.push(events(wrap(d, { type: 'response.completed', response: { id: r } })));
    }
    await Promise.all(done); bursts.push(performance.now() - start);
  }
  for (const mark of timing.snapshot()) (mark.phase === 'tool-dispatch' ? dispatch : result).push(mark.elapsedMs!);
  const snapshot = events.snapshot();
  for (const key of ['calls', 'responses', 'captions', 'fingerprintChars'] as const) peak[key] = Math.max(peak[key], snapshot[key]);
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  events.close();
  if (events.snapshot().calls || events.snapshot().responses || events.snapshot().captions) throw new Error('Event state retained after close');
}
const ownership = new VoiceOwnership();
const roomId = 'a'.repeat(32), sessionId = 'benchmark-session-123';
ownership.begin(roomId, 'fixture', sessionId, 'personal'); ownership.activate(roomId, sessionId);
for (let call = 0; call < 1000; call++) await ownership.runTool({ roomId, sessionId, actor: 'fixture', name: 'add_note', arguments: {}, callId: `receipt${call}` }, async () => ({ objectId: `fixture-${call}`, text: 'x'.repeat(128) }));
const receipts = ownership.snapshot(); ownership.stop(roomId, sessionId);
console.log(JSON.stringify({
  workload: { sessions: 40, bursts: 1000, toolsPerBurst: 4, duplicateDeliveries: 4000, overlappingBursts: 520, executions, outputs, continuations, warnings },
  timingScope: 'Local synthetic provider-speech-stopped receipt to dispatch/result. No acoustic, provider, HTTP or rendered latency.',
  receiptToDispatch: distribution(dispatch), receiptToResult: distribution(result), burstProcessing: distribution(bursts), totalMs: +(performance.now() - started).toFixed(3),
  memory: { startHeapBytes: startHeap, sampledPeakHeapBytes: peakHeap, endHeapBytes: process.memoryUsage().heapUsed, gcControlled: false, peakEventCacheEntries: peak, serverReceiptCache: receipts, serverCacheAfterStop: ownership.snapshot() },
  bounds: { client: VOICE_EVENT_LIMITS, timingMarks: VOICE_TIMING_LIMIT, captionGroups: 2, pendingCaptionWrites: 128, server: VOICE_OWNERSHIP_LIMITS, serverListeners: 100, serverCallsPerListener: 1000 },
}, null, 2));
