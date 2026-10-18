'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { RemoteParticipant, Room } from 'livekit-client';
import * as Y from 'yjs';
import type { InterviewEnvelope, InterviewTranscript } from '@present/contracts/interviews';
import { briefRequest } from './api';

type CallOptions = {
  interview: InterviewEnvelope;
  token: string;
  sharedDocument: Y.Doc;
  onTranscript: (transcript: InterviewTranscript) => Promise<void>;
  onError: (message: string) => void;
};
export function useInterviewCall({ interview, token, sharedDocument, onTranscript, onError }: CallOptions) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [listening, setListening] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const activeRoom = useRef<Room | null>(null);
  const requested = useRef(false);
  const endpoint = `/api/interviews/${interview.id}/call`;
  const receiveTranscript = useEffectEvent(onTranscript);
  const receiveError = useEffectEvent(onError);
  const consented = interview.notesConsent.candidate && interview.notesConsent.recruiter;
  const current = useRef({ interview, consented });
  current.current = { interview, consented };

  useEffect(() => () => { void activeRoom.current?.disconnect(); }, []);
  useEffect(() => {
    if (!room || !connected) return;
    const broadcast = (update: Uint8Array, origin: unknown) => {
      if (origin === 'peer' || update.byteLength > 60000) return;
      void room.localParticipant.publishData(update, { topic: 'open-brief.document', reliable: true }).catch(() => {
        // Durable HTTP synchronization continues if the room data channel is unavailable.
      });
    };
    sharedDocument.on('update', broadcast);
    return () => { sharedDocument.off('update', broadcast); };
  }, [connected, room, sharedDocument]);
  useEffect(() => {
    if (connected && room) {
      setListening(consented && Array.from(room.remoteParticipants.values()).some((participant) => participant.isAgent));
      void room.localParticipant.setAttributes({ 'open-brief.notes-consent': String(interview.notesConsent[interview.role]) })
        .catch(() => receiveError('Could not update live-note permission. Disconnect the call to stop listening.'));
    }
    if (!consented) { requested.current = false; setListening(false); }
    if (connected && consented && interview.role === 'recruiter' && interview.agentAvailable && !requested.current) {
      requested.current = true;
      void briefRequest(endpoint, token, { listen: true }).catch((failure: Error) => { requested.current = false; receiveError(failure.message); });
    }
  }, [connected, consented, endpoint, interview.agentAvailable, interview.notesConsent, interview.role, room, token]);

  async function connect() {
    if (connecting) return;
    if (connected) { await activeRoom.current?.disconnect(); return; }
    setConnecting(true);
    try {
      const [{ Room: LiveKitRoom, RoomEvent, ParticipantKind }, access] = await Promise.all([
        import('livekit-client'), briefRequest<{ token: string; serverUrl: string }>(endpoint, token, {}),
      ]);
      const next = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      activeRoom.current = next;
      next.on(RoomEvent.Disconnected, () => { setConnected(false); setRoom(null); setMic(false); setCamera(false); setListening(false); setAudioBlocked(false); requested.current = false; });
      next.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!next.canPlaybackAudio));
      const agentPresent = () => setListening(current.current.consented && Array.from(next.remoteParticipants.values()).some((participant) => participant.kind === ParticipantKind.AGENT));
      next.on(RoomEvent.ParticipantConnected, agentPresent);
      next.on(RoomEvent.ParticipantDisconnected, agentPresent);
      next.on(RoomEvent.DataReceived, (payload: Uint8Array, sender?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        if (topic === 'open-brief.document' && sender && sender.kind !== ParticipantKind.AGENT && payload.byteLength <= 60000) {
          try { Y.applyUpdate(sharedDocument, payload, 'peer'); } catch { receiveError('A shared edit could not be read. Reconnecting through saved changes.'); }
          return;
        }
        if (topic !== 'transcription' || sender?.kind !== ParticipantKind.AGENT
          || !current.current.consented || current.current.interview.role !== 'recruiter') return;
        try {
          const data = JSON.parse(new TextDecoder().decode(payload));
          if (data.type !== 'live_transcription' || !data.is_final || !data.text?.trim()) return;
          void receiveTranscript({ id: data.event_id, speaker: data.speaker, role: data.role, text: data.text,
            timestamp: data.timestamp, example: false, origin: 'live', ...(data.audioTiming ? { audioTiming: data.audioTiming } : {}) }).catch((failure: Error) => receiveError(failure.message));
        } catch { receiveError('One transcript could not be read. The brief is still saved.'); }
      });
      await next.connect(access.serverUrl, access.token);
      setRoom(next);
      setConnected(true);
      await next.startAudio().catch(() => setAudioBlocked(true));
      agentPresent();
    } catch (failure) {
      await activeRoom.current?.disconnect();
      onError(failure instanceof Error ? failure.message : 'Could not connect the call.');
    } finally { setConnecting(false); }
  }
  async function toggle(kind: 'mic' | 'camera') {
    if (!room || !connected) return;
    try {
      if (kind === 'mic') { await room.localParticipant.setMicrophoneEnabled(!mic); setMic(!mic); }
      else { await room.localParticipant.setCameraEnabled(!camera); setCamera(!camera); }
    } catch { onError(`Could not access your ${kind === 'mic' ? 'microphone' : 'camera'}. Check browser permissions.`); }
  }
  async function enableAudio() {
    try { await room?.startAudio(); setAudioBlocked(Boolean(room && !room.canPlaybackAudio)); }
    catch { setAudioBlocked(true); onError('Tap Enable sound again to allow call audio in this browser.'); }
  }
  return { room, connected, connecting, mic, camera, listening, audioBlocked, enableAudio, connect, toggle };
}
