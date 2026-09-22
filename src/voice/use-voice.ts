import { voicePlacement } from './placement';
import { controlVideo } from '../widgets/youtube-controls';
import { microphoneConstraints } from '../media/microphone';
import type { AgentProvider, GenerationOptions } from '../../shared/agent-models';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createAudioInput, type AudioInput } from './audio-input';
import type { CanvasContextProvider } from '../../shared/canvas-commands';
import { createCanvasContextSender, readCanvasView } from './canvas-context';
import { createRealtimeEvents, voiceError, type VoiceEvent, type VoiceMode, type VoiceStatus, type VoiceTranscript } from './realtime-events';
export type { VoiceMode, VoiceStatus, VoiceTranscript } from './realtime-events';
export type VoiceOptions = { provider?: AgentProvider; generationOptions?: GenerationOptions; selfId: string; viewport?: { x: number; y: number }; audioStreams?: MediaStream[]; mode?: VoiceMode; capture?: 'personal' | 'shared'; name?: string; canvasContext?: CanvasContextProvider };
type Session = {
  id: string; roomId: string; requested: boolean; established: boolean; heartbeat?: ReturnType<typeof setInterval>;
  abort: AbortController; pc?: RTCPeerConnection; stream?: MediaStream; input?: AudioInput;
  channel?: RTCDataChannel; audio?: HTMLAudioElement; timer?: ReturnType<typeof setTimeout>;
  contextTimer?: ReturnType<typeof setInterval>;
  captionWrites: Promise<unknown>; closed?: () => void; flushCaptions?: () => void;
};

export function useVoice(roomId: string, { selfId, viewport, audioStreams = [], mode = 'ambient', capture = 'personal', name = 'Participant', canvasContext, provider = 'luna', generationOptions = {} }: VoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<VoiceTranscript[]>([]);
  const active = useRef<Session | null>(null);
  const generationRef = useRef({ provider, ...generationOptions }); generationRef.current = { provider, ...generationOptions };
  const mounted = useRef(false);
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const streamsRef = useRef(audioStreams); streamsRef.current = audioStreams;
  const modeRef = useRef(mode); modeRef.current = mode;
  const contextRef = useRef(canvasContext); contextRef.current = canvasContext;
  useEffect(() => { active.current?.input?.update(capture === 'shared' ? audioStreams : []); }, [audioStreams, capture]);
  useEffect(() => {
    const session = active.current;
    if (session?.audio) {
      session.audio.muted = mode !== 'conversation';
      if (mode === 'conversation') void session.audio.play().catch(() => setError('Your browser paused voice playback. Allow audio for this page, then reconnect.'));
    }
    if (session?.channel?.readyState === 'open') session.channel.send(JSON.stringify({ type: 'session.instructions.append', delegation_id: null, content: mode === 'ambient' ? 'Listen quietly and delegate explicit requests without spoken commentary.' : 'Speak concisely when addressed and delegate room tasks.' }));
  }, [mode]);

  const dispose = useCallback(() => {
    const session = active.current; session?.flushCaptions?.(); active.current = null;
    if (!session) return;
    session.abort.abort(); clearTimeout(session.timer); clearInterval(session.heartbeat); clearInterval(session.contextTimer);
    if (session.requested) void fetch('/api/voice/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ roomId: session.roomId, sessionId: session.id }),
    }).catch(() => { /* The server also expires abandoned listeners. */ });
    if (session.channel) {
      session.channel.onopen = null; session.channel.onmessage = null;
      session.channel.onclose = null; session.channel.onerror = null; session.channel.close();
    }
    if (session.pc) {
      session.pc.onconnectionstatechange = null; session.pc.ontrack = null;
      session.pc.getReceivers().forEach(receiver => { receiver.track?.stop(); }); session.pc.close();
    }
    session.input?.close();
    session.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (session.audio) { session.audio.pause(); session.audio.srcObject = null; }
  }, []);
  const stop = useCallback(async () => {
    const session = active.current;
    if (session?.channel?.readyState === 'open') {
      const closed = new Promise<void>(resolve => { session.closed = resolve; });
      session.channel.send(JSON.stringify({ type: 'session.close' }));
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    session?.flushCaptions?.();
    if (session) await Promise.race([session.captionWrites, new Promise(resolve => setTimeout(resolve, 2000))]);
    dispose(); if (mounted.current) setStatus('idle');
  }, [dispose]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching room identity must release the old room microphone session.
  useEffect(() => {
    mounted.current = true; setStatus('idle'); setError(null); setTranscript([]);
    const leave = () => dispose();
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); mounted.current = false; dispose(); };
  }, [roomId, selfId, capture, name, dispose]);

  const start = useCallback(async () => {
    if (active.current || !mounted.current) return;
    setError(null);
    if (!selfId) { setError('Wait for your room to connect before starting voice.'); return; }
    const session: Session = { id: crypto.randomUUID(), roomId, requested: false, established: false, abort: new AbortController(), captionWrites: Promise.resolve() };
    active.current = session; setStatus('connecting');
    const current = () => mounted.current && active.current === session;
    const fail = (cause: unknown) => {
      if (!current()) return;
      dispose(); setError(voiceError(cause)); setStatus('error');
    };
    const send = (message: unknown) => {
      if (current() && session.channel?.readyState === 'open') session.channel.send(JSON.stringify(message));
    };
    const context = createCanvasContextSender({ current, provider: () => contextRef.current, send });
    const record = (id: string, role: VoiceTranscript['role'], text: string, final: boolean) => {
      if (!current()) return;
      setTranscript(previous => {
        const existing = previous.find(item => item.id === id);
        const item = { id, role, text: final ? text : `${existing?.text ?? ''}${text}`, final };
        return (existing ? previous.map(entry => entry.id === id ? item : entry) : [...previous, item]).slice(-60);
      });
      if (final && text.trim()) session.captionWrites = session.captionWrites.then(async () => {
        const response = await fetch('/api/voice/transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          signal: AbortSignal.timeout(5000), body: JSON.stringify({ roomId, actor: selfId, sessionId: session.id, arguments: { id, role, text: text.slice(0, 6000) } }) });
        if (!response.ok) throw new Error('A final caption could not be saved to the room.');
      }).catch(cause => { if (current()) setError(voiceError(cause)); });
    };
    const onEvent = createRealtimeEvents({ current, mode: () => modeRef.current, send, record, status: setStatus, error: fail,
      execute: async (name, args, callId) => {
        const view = readCanvasView(contextRef.current, typeof args.nearObjectId === 'string' ? [args.nearObjectId] : []), pageId = view?.pageId;
        const position = voicePlacement(view, args) ?? viewportRef.current;
        const requestArgs = name === 'read_canvas' && pageId && !args.pageId ? { ...args, pageId } : args;
        const still = name === 'ask_canvas' ? await Promise.race([
          contextRef.current?.capture?.('viewport').catch(() => null),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 2500)),
        ]) : null;
        const canvasImage = still && still.dataUrl.length <= 1500000 ? still.dataUrl : undefined;
        const response = await fetch('/api/voice/tool', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: session.abort.signal,
          body: JSON.stringify({ ...generationRef.current, roomId, pageId, position, canvasImage, canvasImageCaption: still?.caption, selection: view?.selectedIds.slice(0, 4).map(id => id.replace(/^shape:/, '')) ?? [], sessionId: session.id, callId, actor: selfId, name, arguments: requestArgs }),
        });
        const result = await response.json();
        if (!response.ok) {
          const cause = new Error(typeof result.error === 'string' ? result.error : 'The room tool could not finish.');
          if (response.status === 409 || response.status === 410) fail(cause);
          throw cause;
        }
        if (name === 'control_video') return controlVideo(result.videoControl);
        if (name === 'native_controls') {
          if (!contextRef.current?.control) throw new Error('Native controls are unavailable.');
          return contextRef.current.control(result.nativeControl);
        }
        if (name === 'read_canvas') return { ...result, listenerContext: await context.readForTool(args) };
        const ids: unknown[] = Array.isArray(result?.shapeIds) ? result.shapeIds : Array.isArray(result?.objectIds) ? result.objectIds : typeof result?.objectId === 'string' ? [result.objectId] : [];
        const createdIds = ids.filter((id): id is string => typeof id === 'string');
        if (createdIds.length) contextRef.current?.reveal?.(createdIds);
        if (name === 'ask_canvas') {
          await new Promise(resolve => setTimeout(resolve, 250));
          return { ...result, visualCheck: await context.readForTool({ includeImage: true, scope: 'viewport' }) };
        }
        return result;
      },
    });
    session.flushCaptions = onEvent.flush;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice needs a secure browser connection and a microphone.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: await microphoneConstraints(), video: false });
      if (!current()) { stream.getTracks().forEach(track => { track.stop(); }); return; }
      session.stream = stream;
      session.timer = setTimeout(() => fail(new Error('Voice took too long to connect. Please try again.')), 30000);
      const pc = new RTCPeerConnection(); session.pc = pc;
      const audio = new Audio(); audio.autoplay = true; audio.muted = modeRef.current !== 'conversation'; session.audio = audio;
      pc.ontrack = event => {
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        if (!audio.muted) void audio.play().catch(() => { if (current()) setError('Your browser paused voice playback. Allow audio for this page, then reconnect.'); });
      };
      for (const track of stream.getAudioTracks()) track.onended = () => fail(new Error('Microphone access ended. Start voice to reconnect.'));
      session.input = createAudioInput(stream); session.input.update(capture === 'shared' ? streamsRef.current : []);
      await session.input.ready;
      if (!current()) return;
      for (const track of session.input.stream.getAudioTracks()) pc.addTrack(track, session.input.stream);
      pc.onconnectionstatechange = () => {
        if (!current()) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail(new Error('Voice disconnected. Start voice to reconnect.'));
        if (pc.connectionState === 'disconnected') {
          clearTimeout(session.timer);
          session.timer = setTimeout(() => fail(new Error('Voice disconnected. Start voice to reconnect.')), 8000);
        }
        if (pc.connectionState === 'connected' && session.channel?.readyState === 'open') clearTimeout(session.timer);
      };
      const channel = pc.createDataChannel('oai-events'); session.channel = channel;
      channel.onopen = () => {
        if (!current()) return;
        // Wait for the provider's session.started acknowledgment.

      };
      channel.onclose = () => fail(new Error('Voice disconnected. Start voice to reconnect.'));
      channel.onerror = () => fail(new Error('The voice data connection failed. Please try again.'));
      channel.onmessage = message => {
        let event: VoiceEvent;
        try { event = JSON.parse(String(message.data)) as VoiceEvent; } catch { return; }
        if (event.type === 'session.closed') { onEvent.flush(); session.closed?.(); return; }
        if (event.type === 'session.started') { clearTimeout(session.timer); context.publish(); session.contextTimer = setInterval(context.publish, 1500); }
        if (event && typeof event.type === 'string') void onEvent(event).catch(fail);
      };
      const offer = await pc.createOffer();
      if (!current()) return;
      await pc.setLocalDescription(offer);
      if (!current()) return;
      const query = new URLSearchParams({ roomId, actor: selfId, sessionId: session.id, capture, name, mode: modeRef.current });
      if (viewportRef.current) query.set('viewport', JSON.stringify(viewportRef.current));
      const ownershipKey = `present:voice-session:${roomId}`;
      const previousSession = sessionStorage.getItem(ownershipKey);
      if (previousSession && previousSession !== session.id) {
        await fetch('/api/voice/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, sessionId: previousSession }), signal: session.abort.signal });
      }
      if (!current()) return;
      sessionStorage.setItem(ownershipKey, session.id);
      session.requested = true;
      const response = await fetch(`/api/voice/session?${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp, signal: session.abort.signal,
      });
      const answer = await response.text();
      if (!response.ok) {
        let detail = 'Voice could not connect. Please try again.';
        try { detail = (JSON.parse(answer) as { error?: string }).error || detail; } catch { /* Do not display upstream HTML. */ }
        throw new Error(detail);
      }
      if (!current()) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      if (!current()) return;
      session.established = true;
      session.heartbeat = setInterval(() => {
        if (!current() || !session.established) return;
        void fetch('/api/voice/heartbeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([session.abort.signal, AbortSignal.timeout(10000)]),
          body: JSON.stringify({ roomId, sessionId: session.id }),
        }).then(async response => {
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(typeof result.error === 'string' ? result.error : 'The room voice listener expired. Reconnect to continue.');
          }
        }).catch(fail);
      }, 20000);
    } catch (cause) { fail(cause); }
  }, [roomId, selfId, capture, name, dispose]);

  return { status, error, start, stop, transcript, mode };
}
