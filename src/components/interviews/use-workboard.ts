'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track, type Room } from 'livekit-client';

export function useWorkboard(room: Room | null, onFile: (file: File) => Promise<void>, onError: (message: string) => void) {
  const [stream, setStream] = useState<MediaStream | null>(null); const [sharing, setSharing] = useState(false); const [capturing, setCapturing] = useState(false);
  const video = useRef<HTMLVideoElement>(null); const local = useRef<MediaStream | null>(null);
  useEffect(() => () => { for (const track of local.current?.getTracks() || []) track.stop(); }, []);
  useEffect(() => {
    if (!room) return;
    let trackId = '';
    const refresh = () => {
      setSharing(room.localParticipant.isScreenShareEnabled);
      const participants = [...room.remoteParticipants.values(), room.localParticipant];
      const track = participants.map((person) => person.getTrackPublication(Track.Source.ScreenShare)?.videoTrack).find((item) => item && !item.isMuted);
      if (track && track.mediaStreamTrack.id !== trackId) { trackId = track.mediaStreamTrack.id; setStream(new MediaStream([track.mediaStreamTrack])); }
      if (!track && trackId) { trackId = ''; setStream(local.current); }
    };
    const events = [RoomEvent.TrackSubscribed,RoomEvent.TrackUnsubscribed,RoomEvent.LocalTrackPublished,RoomEvent.LocalTrackUnpublished];
    for (const event of events) room.on(event,refresh); refresh();
    return () => { for (const event of events) room.off(event,refresh); };
  }, [room]);
  const attach = useCallback((element: HTMLVideoElement | null) => { video.current = element; if (element) element.srcObject = stream; }, [stream]);
  async function show() {
    try {
      if (sharing) {
        if (room) await room.localParticipant.setScreenShareEnabled(false);
        for (const track of local.current?.getTracks() || []) track.stop();
        local.current = null; setStream(null); setSharing(false); return false;
      }
      if (room) { await room.localParticipant.setScreenShareEnabled(true); setSharing(true); return true; }
      else {
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is unavailable in this browser. You can upload a screenshot instead.');
        const next = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        local.current = next; setStream(next); setSharing(true);
        next.getVideoTracks()[0].addEventListener('ended', () => { local.current = null; setStream(null); setSharing(false); });
        return true;
      }
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'NotAllowedError')) onError(failure instanceof Error ? failure.message : 'Could not share the screen.'); return false; }
  }
  async function capture() {
    const element = video.current;
    if (!element || element.readyState < 2 || !element.videoWidth) return;
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas'); const scale = Math.min(1, 1600 / element.videoWidth);
      canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not capture this frame.')), 'image/png'));
      await onFile(new File([blob], 'Screen capture.png', { type: 'image/png' }));
    } catch (failure) { onError(failure instanceof Error ? failure.message : 'Could not save the frame.'); }
    finally { setCapturing(false); }
  }
  return { stream, sharing, capturing, video, attach, show, capture, previewOnly: Boolean(stream && !room) };
}
