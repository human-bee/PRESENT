export const VOICE_TIMING_LIMIT = 512;
export type VoiceTimingMark = Readonly<{
  sessionId: string; responseId: string; delegationId: string; callId: string;
  phase: 'tool-dispatch' | 'tool-result'; at: number; boundaryAt?: number;
  boundary: 'provider-speech-stopped-received' | 'input-transcript-received' | 'unavailable';
  elapsedMs?: number;
}>;
/** Local, content-free diagnostic ring. Not a browser paint or acoustic latency measurement. */
export function createVoiceTiming(now = () => performance.now(), limit = VOICE_TIMING_LIMIT) {
  const capacity = Math.max(1, Math.min(VOICE_TIMING_LIMIT, Math.floor(limit) || VOICE_TIMING_LIMIT));
  const marks: VoiceTimingMark[] = [];
  return {
    now,
    mark(value: Omit<VoiceTimingMark, 'at' | 'elapsedMs'>) {
      const at = now();
      marks.push(Object.freeze({ ...value, sessionId: value.sessionId.slice(0, 100), responseId: value.responseId.slice(0, 100), delegationId: value.delegationId.slice(0, 100), callId: value.callId.slice(0, 100), at,
        ...(value.boundaryAt === undefined ? {} : { elapsedMs: Math.max(0, at - value.boundaryAt) }) }));
      if (marks.length > capacity) marks.shift();
    },
    snapshot: () => Object.freeze(marks.map(mark => Object.freeze({ ...mark }))),
  };
}
export type VoiceTiming = ReturnType<typeof createVoiceTiming>;
export const localVoiceTiming = createVoiceTiming();
/** Read-only copies; contains IDs/times only, never prompts, arguments or transcripts. */
export const exportVoiceTiming = () => localVoiceTiming.snapshot();
