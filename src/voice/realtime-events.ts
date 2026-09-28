import { localVoiceTiming, type VoiceTiming } from './timing';
import { VOICE_TOOL_NAMES } from '../../shared/voice-tool-names';

export type VoiceMode = 'ambient' | 'conversation';
export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'error';
export type VoiceTranscript = { id: string; role: 'user' | 'assistant'; text: string; final: boolean };
export type ToolCall = { type?: string; call_id?: string; name?: string; arguments?: string };
export type VoiceEvent = ToolCall & {
  type: string; item_id?: string; delta?: string; text?: string; transcript?: string;
  error?: { message?: string; code?: string };
  response?: { id?: string; status?: string; output?: ToolCall[]; status_details?: { error?: { message?: string } } };
};
const toolNames = new Set<string>(VOICE_TOOL_NAMES);
export const outputModalities = (mode: VoiceMode) => mode === 'conversation' ? ['audio'] : ['text'];
export function voiceError(error: unknown): string {
  if (!(error instanceof Error)) return 'Voice could not connect. Please try again.';
  if (error instanceof TypeError && /failed to fetch|fetch failed|networkerror|load failed/i.test(error.message)) return 'Could not reach the room server. It may be restarting or offline. Once the room reconnects, start listening again.';
  if (error.name === 'NotAllowedError') return 'Allow microphone access in your browser to use voice.';
  if (error.name === 'NotFoundError') return 'No microphone was found.';
  return error.message;
}
export type RealtimeOptions = {
  sessionId?: string; timing?: VoiceTiming; warning?: (message: string) => void;
  current: () => boolean; mode: () => VoiceMode; send: (message: unknown) => void;
  execute: (name: string, args: Record<string, unknown>, callId: string) => Promise<unknown>;
  status: (status: VoiceStatus) => void; error: (error: Error) => void;
  record: (id: string, role: VoiceTranscript['role'], text: string, final: boolean) => void;
};

// These are session ceilings, not LRU caches: evicting a mutating call ID permits replay.
export const VOICE_EVENT_LIMITS = Object.freeze({ calls: 1000, responses: 2000, captions: 8000, idChars: 100, argumentChars: 65536, fingerprintChars: 1048576 });
type ResponseState = {
  id: string; delegation: string; calls: Set<string>; completed: boolean; continued: boolean;
  unsafeContinuation: boolean; ambiguousIdentity: boolean; boundary: 'provider-speech-stopped-received' | 'input-transcript-received' | 'unavailable'; boundaryAt?: number;
};
export type RealtimeEnvelope = VoiceEvent & { event_id?: string; start_ms?: number; end_ms?: number; delegation_id?: string; event?: VoiceEvent & { item?: ToolCall } };

// The local GPT-Live contract has call_id-targeted outputs, but only an unscoped
// response.create. Do not invent outbound response_id/delegation_id fields.
export function createRealtimeEvents(options: RealtimeOptions) {
  const calls = new Map<string, { fingerprint: string; response: ResponseState; task: Promise<void> }>();
  const responses = new Map<string, ResponseState>();
  const captions = new Set<string>();
  const timing = options.timing ?? localVoiceTiming;
  let dispatching = true, closed = false, fingerprintChars = 0;
  let boundary: ResponseState['boundary'] = 'unavailable', boundaryAt: number | undefined;
  const groups = new Map<VoiceTranscript['role'], { id: string; text: string; end: number; timer?: ReturnType<typeof setTimeout> }>();
  const flush = () => {
    for (const [role, group] of groups) { clearTimeout(group.timer); options.record(group.id, role, group.text, true); }
    groups.clear();
  };
  const fail = (message: string) => { dispatching = false; options.error(new Error(message)); };
  const validId = (id: string) => id.length > 0 && id.length <= VOICE_EVENT_LIMITS.idChars;
  const key = (delegation: string, id: string) => JSON.stringify([delegation, id]);
  const resolve = (delegation: string, id?: string) => {
    if (id) return responses.get(key(delegation, id));
    const candidates = [...responses.values()].filter(response => response.delegation === delegation && !response.completed);
    // Never use whichever response happened to arrive last.
    return candidates.length === 1 && !candidates[0].ambiguousIdentity ? candidates[0] : undefined;
  };
  const handler = async (envelope: RealtimeEnvelope) => {
    if (closed || !options.current()) return;
    if (envelope.type === 'error') { if (dispatching) fail(envelope.error?.message || 'GPT-Live reported an error.'); return; }
    if (envelope.type === 'session.started' && dispatching) options.status('listening');
    // Observed in tests/live/native-voice.mjs (legacy Realtime); GPT-Live is not
    // assumed to emit this. Caption receipt below is explicitly a weaker proxy.
    if (envelope.type === 'input_audio_buffer.speech_stopped') { boundary = 'provider-speech-stopped-received'; boundaryAt = timing.now(); return; }
    if (envelope.type === 'session.input_transcript.delta' || envelope.type === 'session.output_transcript.delta') {
      const id = envelope.event_id;
      if (!id || !validId(id) || captions.has(id)) return;
      if (captions.size >= VOICE_EVENT_LIMITS.captions) { fail('Voice caption history is full. Start a fresh voice session.'); return; }
      captions.add(id);
      const role = envelope.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      if (role === 'user') { boundary = 'input-transcript-received'; boundaryAt = timing.now(); }
      const delta = envelope.delta || '';
      if (delta.length > 6000) { fail('A voice caption fragment exceeded the save limit. It could not be saved in full.'); return; }
      let group = groups.get(role);
      if (group && ((envelope.start_ms ?? group.end) - group.end > 1500 || group.text.length > 2000 || group.text.length + delta.length > 6000)) {
        clearTimeout(group.timer); options.record(group.id, role, group.text, true); groups.delete(role); group = undefined;
      }
      if (!group) { group = { id, text: '', end: envelope.end_ms ?? 0 }; groups.set(role, group); }
      clearTimeout(group.timer); group.text += delta; group.end = envelope.end_ms ?? group.end;
      options.record(group.id, role, delta, false);
      const currentGroup = group;
      group.timer = setTimeout(() => {
        if (closed || groups.get(role) !== currentGroup) return;
        groups.delete(role); options.record(currentGroup.id, role, currentGroup.text, true);
      }, 1200);
      return;
    }
    if (!dispatching || envelope.type !== 'response.event' || !envelope.event) return;
    const event = envelope.event, delegation = envelope.delegation_id ?? '';
    if (delegation.length > VOICE_EVENT_LIMITS.idChars) { fail('Invalid voice delegation identity.'); return; }
    if (event.type === 'response.created' && event.response?.id) {
      const id = event.response.id;
      if (!validId(id)) { fail('Invalid voice response identity.'); return; }
      if (responses.has(key(delegation, id))) return;
      if (responses.size >= VOICE_EVENT_LIMITS.responses) { fail('Voice response history is full. Start a fresh voice session.'); return; }
      const overlapping = [...responses.values()].filter(response => !response.continued);
      for (const response of overlapping) { response.unsafeContinuation = true; if (response.delegation === delegation) response.ambiguousIdentity = true; }
      responses.set(key(delegation, id), { id, delegation, calls: new Set(), completed: false, continued: false, unsafeContinuation: overlapping.length > 0, ambiguousIdentity: overlapping.some(response => response.delegation === delegation), boundary, boundaryAt });
      options.status('thinking'); return;
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const call = event.item, callId = call.call_id;
      if (!callId || !validId(callId)) { fail('Invalid voice call identity.'); return; }
      const response = resolve(delegation, event.response?.id);
      const existing = calls.get(callId);
      const fingerprint = JSON.stringify([call.name, call.arguments || '{}']);
      if (fingerprint.length > VOICE_EVENT_LIMITS.argumentChars) { fail('Voice tool arguments are too large.'); return; }
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.response.delegation !== delegation || (event.response?.id && existing.response.id !== event.response.id)) fail('A voice call ID was reused for a different request.');
        return;
      }
      if (!response || response.completed) { fail('Voice tool response is missing or ambiguous; no tool was dispatched.'); return; }
      if (calls.size >= VOICE_EVENT_LIMITS.calls || fingerprintChars + fingerprint.length > VOICE_EVENT_LIMITS.fingerprintChars) { fail('Voice tool history is full. Start a fresh voice session.'); return; }
      response.calls.add(callId); fingerprintChars += fingerprint.length;
      const tags = { sessionId: options.sessionId ?? 'local', responseId: response.id, delegationId: delegation, callId, boundary: response.boundary, boundaryAt: response.boundaryAt };
      const task = Promise.resolve().then(async () => {
        if (!dispatching || closed || !options.current()) return;
        let result: unknown;
        try {
          if (!call.name || !toolNames.has(call.name)) throw new Error('Unknown room tool.');
          const args = JSON.parse(call.arguments || '{}');
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid room tool arguments.');
          timing.mark({ ...tags, phase: 'tool-dispatch' });
          result = await options.execute(call.name, args, callId);
        } catch (error) { result = { error: voiceError(error) }; }
        timing.mark({ ...tags, phase: 'tool-result' });
        if (dispatching && !closed && options.current()) options.send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result ?? null) } });
      });
      calls.set(callId, { fingerprint, response, task });
      // The completion path awaits this too; avoid an unhandled send exception.
      void task.catch(error => { if (dispatching && options.current()) options.error(error instanceof Error ? error : new Error('Voice output failed.')); });
      return;
    }
    if (event.type === 'response.failed') { fail('The delegated backend failed. Please retry.'); return; }
    if (event.type !== 'response.completed') return;
    const response = resolve(delegation, event.response?.id);
    if (!response) { fail('Voice completion is missing or ambiguous.'); return; }
    if (response.completed) return;
    response.completed = true;
    await Promise.all([...response.calls].map(callId => calls.get(callId)?.task));
    response.continued = true;
    if (!dispatching || closed || !options.current()) return;
    if (response.calls.size && !response.unsafeContinuation) options.send({ type: 'response.create' });
    else {
      if (response.calls.size) options.warning?.('Tool results were returned by call ID. Automatic continuation was withheld because this transport has no verified targeting for overlapping responses.');
      if (![...responses.values()].some(item => !item.continued)) options.status('listening');
    }
  };
  return Object.assign(handler, {
    flush,
    quiesce() { dispatching = false; },
    close() { dispatching = false; flush(); closed = true; calls.clear(); responses.clear(); captions.clear(); fingerprintChars = 0; },
    snapshot: () => Object.freeze({ calls: calls.size, responses: responses.size, captions: captions.size, groups: groups.size, fingerprintChars, dispatching, closed }),
  });
}
