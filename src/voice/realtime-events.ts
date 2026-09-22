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
type Options = {
  current: () => boolean; mode: () => VoiceMode; send: (message: unknown) => void;
  execute: (name: string, args: Record<string, unknown>, callId: string) => Promise<unknown>;
  status: (status: VoiceStatus) => void; error: (error: Error) => void;
  record: (id: string, role: VoiceTranscript['role'], text: string, final: boolean) => void;
};

// GPT-Live speaks independently; nested Responses events own tool execution.
export function createRealtimeEvents(options: Options) {
  const calls = new Map<string, Promise<void>>();
  const responses = new Map<string, Set<string>>();
  const active = new Map<string, string>();
  const continued = new Set<string>();
  const captions = new Set<string>();
  const groups = new Map<VoiceTranscript['role'], { id: string; text: string; end: number; timer?: ReturnType<typeof setTimeout> }>();
  const flush = () => {
    for (const [role, group] of groups) { clearTimeout(group.timer); options.record(group.id, role, group.text, true); }
    groups.clear();
  };
  const handler = async (envelope: VoiceEvent & { event_id?: string; start_ms?: number; end_ms?: number; delegation_id?: string; event?: VoiceEvent & { item?: ToolCall } }) => {
    if (!options.current()) return;
    if (envelope.type === 'error') { options.error(new Error(envelope.error?.message || 'GPT-Live reported an error.')); return; }
    if (envelope.type === 'session.started') options.status('listening');
    if (envelope.type === 'session.input_transcript.delta' || envelope.type === 'session.output_transcript.delta') {
      const id = envelope.event_id;
      if (!id || captions.has(id)) return;
      captions.add(id);
      const role = envelope.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      let group = groups.get(role);
      if (group && ((envelope.start_ms ?? group.end) - group.end > 1500 || group.text.length > 2000)) {
        clearTimeout(group.timer); options.record(group.id, role, group.text, true); groups.delete(role); group = undefined;
      }
      if (!group) { group = { id, text: '', end: envelope.end_ms ?? 0 }; groups.set(role, group); }
      clearTimeout(group.timer); group.text += envelope.delta || ''; group.end = envelope.end_ms ?? group.end;
      options.record(group.id, role, envelope.delta || '', false);
      const currentGroup = group;
      group.timer = setTimeout(() => {
        if (groups.get(role) !== currentGroup) return;
        groups.delete(role); options.record(currentGroup.id, role, currentGroup.text, true);
      }, 1200);
      return;
    }
    if (envelope.type !== 'response.event' || !envelope.event) return;
    const event = envelope.event, delegation = envelope.delegation_id ?? '';
    if (event.type === 'response.created' && event.response?.id) {
      active.set(delegation, event.response.id); responses.set(event.response.id, new Set()); options.status('thinking');
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const call = event.item, callId = call.call_id;
      if (!callId) return;
      const responseId = active.get(delegation);
      if (!responseId) { options.error(new Error('Backend tool arrived without a response ID.')); return; }
      responses.get(responseId)?.add(callId);
      if (!calls.has(callId)) {
        const task = (async () => {
          let result: unknown;
          try {
            if (!call.name || !toolNames.has(call.name)) throw new Error('Unknown room tool.');
            const args = JSON.parse(call.arguments || '{}');
            if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid room tool arguments.');
            result = await options.execute(call.name, args, callId);
          } catch (error) { result = { error: voiceError(error) }; }
          if (options.current()) options.send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result ?? null) } });
        })();
        calls.set(callId, task);
      }
      return;
    }
    if (event.type === 'response.failed') { options.error(new Error('The delegated backend failed. Please retry.')); return; }
    if (event.type !== 'response.completed') return;
    const id = event.response?.id ?? active.get(delegation);
    if (!id || continued.has(id)) return;
    continued.add(id);
    const pending = [...(responses.get(id) ?? [])];
    await Promise.all(pending.map(callId => calls.get(callId)));
    if (!options.current()) return;
    if (pending.length) options.send({ type: 'response.create' });
    else options.status('listening');
  };
  return Object.assign(handler, { flush });
}
