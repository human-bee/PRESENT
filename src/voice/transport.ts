import type { AgentProvider, GenerationOptions } from '../../shared/agent-models';
import type { CanvasContextProvider } from '../../shared/canvas-commands';
import { microphoneConstraints } from '../media/microphone';
import { controlVideo } from '../widgets/youtube-controls';
import { createAudioInput, type AudioInput } from './audio-input';
import { createCanvasContextSender, readCanvasView } from './canvas-context';
import { createCaptionQueue } from './caption-queue';
import { waitForIceGathering } from './ice';
import { createVoiceLifecycle, VoiceFailure, waitAtMost, pauseVoice } from './lifecycle';
import { voicePlacement } from './placement';
import { createRealtimeEvents, voiceError, type RealtimeEnvelope, type VoiceMode, type VoiceStatus, type VoiceTranscript } from './realtime-events';

type Session = {
  id: string; requested: boolean; stopping: boolean; drainingCaptions: boolean; abort: AbortController;
  pc?: RTCPeerConnection; channel?: RTCDataChannel; audio?: HTMLAudioElement; stream?: MediaStream; input?: AudioInput;
  setupTimer?: ReturnType<typeof setTimeout>; disconnectTimer?: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setInterval>; contextTimer?: ReturnType<typeof setInterval>; heartbeatPending?: boolean;
  closed?: () => void; events?: ReturnType<typeof createRealtimeEvents>; captions: ReturnType<typeof createCaptionQueue>;
};
export type VoiceTransportOptions = {
  beforeConnect?: () => Promise<void>;
  roomId: string; selfId: string; capture: 'personal' | 'shared'; name: string;
  mode: () => VoiceMode; streams: () => MediaStream[]; context: () => CanvasContextProvider | undefined;
  viewport: () => { x: number; y: number } | undefined;
  generation: () => { provider?: AgentProvider } & GenerationOptions;
  status: (status: VoiceStatus) => void; error: (error: string | null) => void;
  record: (id: string, role: VoiceTranscript['role'], text: string, final: boolean) => void;
};
/** HTTP tool failures are results. Lease loss is established separately by heartbeat. */
export async function readVoiceToolResult(response: Response): Promise<Record<string, any>> {
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'The room tool could not finish.');
  return result;
}

export function createVoiceTransport(options: VoiceTransportOptions) {
  const { roomId, selfId, capture, name } = options;
  const safely = (close: () => void) => { try { close(); } catch { /* Continue releasing the other resources. */ } };
  const ownershipKey = `present:voice-session:${roomId}`;
  const post = (path: string, body: unknown, signal: AbortSignal, keepalive = false) => fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, keepalive,
  });
  const stopRemote = async (sessionId: string, signal?: AbortSignal) => {
    const response = await post('/api/voice/stop', { roomId, sessionId }, signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000), true);
    if (!response.ok) throw new VoiceFailure('The previous listener could not be released.', response.status >= 500);
    if (sessionStorage.getItem(ownershipKey) === sessionId) sessionStorage.removeItem(ownershipKey);
  };
  const lifecycle = createVoiceLifecycle<Session>({
    status: options.status, error: options.error,
    create: () => {
      const id = crypto.randomUUID();
      const session: Session = { id, requested: false, stopping: false, drainingCaptions: true, abort: new AbortController(),
        captions: createCaptionQueue(async (signal, captionId, role, text) => {
          const response = await post('/api/voice/transcript', { roomId, actor: selfId, sessionId: id, arguments: { id: captionId, role, text: text.slice(0, 6000) } }, signal, true);
          if (!response.ok) throw new Error('A final caption could not be saved to the room.');
        }, cause => { if (!lifecycle.active || lifecycle.current(session)) options.error(voiceError(cause)); }),
      };
      return session;
    },
    quiesce: session => {
      session.stopping = true; session.events?.quiesce(); session.abort.abort();
      clearTimeout(session.setupTimer); clearTimeout(session.disconnectTimer);
      clearInterval(session.heartbeat); clearInterval(session.contextTimer);
      if (session.pc) {
        session.pc.onconnectionstatechange = null; session.pc.ontrack = null;
        session.pc.getReceivers().forEach(receiver => { safely(() => receiver.track?.stop()); });
      }
      safely(() => session.input?.close());
      session.stream?.getTracks().forEach(track => { track.onended = null; safely(() => track.stop()); });
      if (session.audio) { safely(() => session.audio?.pause()); session.audio.srcObject = null; }
      session.events?.flush();
    },
    drain: async (session, graceful) => {
      if (graceful && session.channel?.readyState === 'open') {
        const closed = new Promise<void>(resolve => { session.closed = resolve; });
        try { session.channel.send(JSON.stringify({ type: 'session.close' })); await waitAtMost(closed, 3000); }
        catch { /* Closed transports cannot supply more final fragments. */ }
      }
      session.events?.close(); session.drainingCaptions = false;
      await session.captions.drain();
    },
    release: async session => {
      if (session.channel) {
        session.channel.onopen = null; session.channel.onmessage = null; session.channel.onclose = null; session.channel.onerror = null;
        safely(() => session.channel?.close());
      }
      safely(() => session.pc?.close());
      if (session.requested) await stopRemote(session.id);
    },
    connect: async session => {
      const current = () => lifecycle.current(session) && !session.stopping;
      const fail = (cause: unknown, retryable = false) => lifecycle.fail(session, cause instanceof VoiceFailure ? cause : new VoiceFailure(voiceError(cause), retryable));
      const send = (message: unknown) => {
        if (current() && session.channel?.readyState === 'open') session.channel.send(JSON.stringify(message));
      };
      const context = createCanvasContextSender({ current, provider: options.context, send });
      const record = (id: string, role: VoiceTranscript['role'], text: string, final: boolean) => {
        if (!session.drainingCaptions) return;
        if (current()) options.record(id, role, text, final);
        if (final && text.trim()) session.captions.append(id, role, text);
      };
      const events = createRealtimeEvents({ sessionId: session.id,
        current: () => current() || (session.stopping && session.drainingCaptions), mode: options.mode, send, record,
        status: status => { if (current()) options.status(status); }, error: cause => fail(cause),
        warning: message => { if (current()) options.error(message); },
        execute: async (toolName, args, callId) => {
          session.abort.signal.throwIfAborted();
          const view = readCanvasView(options.context(), typeof args.nearObjectId === 'string' ? [args.nearObjectId] : []), pageId = view?.pageId;
          const position = voicePlacement(view, args) ?? options.viewport();
          const requestArgs = toolName === 'read_canvas' && pageId && !args.pageId ? { ...args, pageId } : args;
          const still = toolName === 'ask_canvas' ? await waitAtMost(options.context()?.capture?.('viewport').catch(() => null) ?? Promise.resolve(null), 2500) : null;
          session.abort.signal.throwIfAborted();
          const response = await post('/api/voice/tool', {
            ...options.generation(), roomId, pageId, position,
            canvasImage: still && still.dataUrl.length <= 1500000 ? still.dataUrl : undefined, canvasImageCaption: still?.caption,
            selection: view?.selectedIds.slice(0, 4).map(id => id.replace(/^shape:/, '')) ?? [],
            sessionId: session.id, callId, actor: selfId, name: toolName, arguments: requestArgs,
          }, session.abort.signal);
          const result = await readVoiceToolResult(response);
          session.abort.signal.throwIfAborted();
          if (toolName === 'control_video') return controlVideo(result.videoControl);
          if (toolName === 'native_controls') {
            if (!options.context()?.control) throw new Error('Native controls are unavailable.');
            return options.context()!.control!(result.nativeControl);
          }
          if (toolName === 'read_canvas') return { ...result, listenerContext: await context.readForTool(args) };
          const ids: unknown[] = Array.isArray(result?.shapeIds) ? result.shapeIds : Array.isArray(result?.objectIds) ? result.objectIds : typeof result?.objectId === 'string' ? [result.objectId] : [];
          const createdIds = ids.filter((id): id is string => typeof id === 'string');
          if (createdIds.length) options.context()?.reveal?.(createdIds);
          if (toolName === 'ask_canvas') {
            await pauseVoice(250, session.abort.signal);
            session.abort.signal.throwIfAborted();
            return { ...result, visualCheck: await context.readForTool({ includeImage: true, scope: 'viewport' }) };
          }
          return result;
        },
      });
      session.events = events;
      try {
        await options.beforeConnect?.();
        if (!current()) return;
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice needs a secure browser connection and a microphone.');
        const constraints = await microphoneConstraints();
        if (!current()) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
        if (!current()) { stream.getTracks().forEach(track => { track.stop(); }); return; }
        session.stream = stream;
        session.setupTimer = setTimeout(() => fail(new Error('Voice took too long to connect.'), true), 30000);
        const pc = new RTCPeerConnection(); session.pc = pc;
        const audio = new Audio(); audio.autoplay = true; audio.muted = options.mode() !== 'conversation'; session.audio = audio;
        pc.ontrack = event => {
          if (!current()) { event.track.stop(); return; }
          audio.srcObject = event.streams[0] || new MediaStream([event.track]);
          if (!audio.muted) void audio.play().catch(() => { if (current()) options.error('Your browser paused voice playback. Allow audio for this page, then reconnect.'); });
        };
        for (const track of stream.getAudioTracks()) track.onended = () => fail(new Error('Microphone access ended. Start voice to reconnect.'));
        session.input = createAudioInput(stream); session.input.update(capture === 'shared' ? options.streams() : []);
        await session.input.ready;
        if (!current()) return;
        for (const track of session.input.stream.getAudioTracks()) pc.addTrack(track, session.input.stream);
        pc.onconnectionstatechange = () => {
          if (!current()) return;
          if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail(new Error('Voice disconnected.'), true);
          if (pc.connectionState === 'disconnected' && !session.disconnectTimer) session.disconnectTimer = setTimeout(() => fail(new Error('Voice disconnected.'), true), 8000);
          if (pc.connectionState === 'connected') { clearTimeout(session.disconnectTimer); session.disconnectTimer = undefined; }
        };
        const channel = pc.createDataChannel('oai-events'); session.channel = channel;
        channel.onclose = () => { session.closed?.(); if (current()) fail(new Error('Voice disconnected.'), true); };
        channel.onerror = () => { if (current()) fail(new Error('The voice data connection failed.'), true); };
        channel.onmessage = message => {
          let event: RealtimeEnvelope;
          try { event = JSON.parse(String(message.data)) as RealtimeEnvelope; } catch { return; }
          if (!event || typeof event.type !== 'string') return;
          if (event.type === 'session.closed') {
            events.flush(); session.closed?.();
            if (current()) fail(new Error('The voice session ended.'), true);
            return;
          }
          if (event.type === 'session.started' && current()) {
            clearTimeout(session.setupTimer); options.error(null); context.publish();
            clearInterval(session.contextTimer); session.contextTimer = setInterval(context.publish, 1500);
          }
          void events(event).catch(cause => fail(cause));
        };
        const offer = await pc.createOffer(); if (!current()) return;
        await pc.setLocalDescription(offer); if (!current()) return;
        await waitForIceGathering(pc, session.abort.signal); if (!current()) return;
        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error('The browser did not produce a voice connection offer.');
        const query = new URLSearchParams({ roomId, actor: selfId, sessionId: session.id, capture, name, mode: options.mode() });
        if (options.viewport()) query.set('viewport', JSON.stringify(options.viewport()));
        const previousSession = sessionStorage.getItem(ownershipKey);
        if (previousSession && previousSession !== session.id) await stopRemote(previousSession, session.abort.signal);
        if (!current()) return;
        sessionStorage.setItem(ownershipKey, session.id); session.requested = true;
        const response = await fetch(`/api/voice/session?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: sdp, signal: session.abort.signal });
        const answer = await response.text();
        if (!response.ok) {
          let detail = 'Voice could not connect.';
          try { detail = (JSON.parse(answer) as { error?: string }).error || detail; } catch { /* Do not display upstream HTML. */ }
          throw new VoiceFailure(detail, response.status >= 500 || response.status === 429);
        }
        if (!current()) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: answer }); if (!current()) return;
        session.heartbeat = setInterval(() => {
          if (!current() || session.heartbeatPending) return;
          session.heartbeatPending = true;
          void post('/api/voice/heartbeat', { roomId, sessionId: session.id }, AbortSignal.any([session.abort.signal, AbortSignal.timeout(10000)]))
            .then(async response => {
              if (response.ok) return;
              const result = await response.json().catch(() => ({}));
              throw new VoiceFailure(typeof result.error === 'string' ? result.error : 'The voice listener lease expired.', response.status === 410 || response.status >= 500);
            }).catch(cause => fail(cause, cause instanceof TypeError || (cause instanceof Error && cause.name === 'TimeoutError')))
            .finally(() => { session.heartbeatPending = false; });
        }, 20000);
      } catch (cause) { fail(cause, cause instanceof TypeError || (cause instanceof Error && cause.name === 'TimeoutError')); }
    },
  });
  return {
    start: () => { if (!selfId) { options.error('Wait for your room to connect before starting voice.'); return; } lifecycle.start(); },
    stop: () => lifecycle.stop(), dispose: () => lifecycle.stop(false), snapshot: lifecycle.snapshot,
    updateInput() { const session = lifecycle.active; if (session) session.input?.update(capture === 'shared' ? options.streams() : []); },
    updateMode() {
      const session = lifecycle.active; if (!session) return;
      if (session.audio) {
        session.audio.muted = options.mode() !== 'conversation';
        if (!session.audio.muted) void session.audio.play().catch(() => { if (lifecycle.current(session)) options.error('Your browser paused voice playback. Allow audio for this page, then reconnect.'); });
      }
      if (session.channel?.readyState === 'open') session.channel.send(JSON.stringify({ type: 'session.instructions.append', delegation_id: null, content: options.mode() === 'ambient' ? 'Listen quietly and delegate explicit requests without spoken commentary.' : 'Speak concisely when addressed and delegate room tasks.' }));
    },
  };
}
