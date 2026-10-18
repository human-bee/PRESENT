'use client';

import { useEffect, useRef, useState } from 'react';
import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import { RoomEvent, Track, type Participant, type Room } from 'livekit-client';
import { MicOff } from 'lucide-react';

function ParticipantFrame({ participant }: { participant: Participant }) {
  const video = useRef<HTMLVideoElement>(null);
  const track = participant.getTrackPublication(Track.Source.Camera)?.videoTrack;
  useEffect(() => {
    const element = video.current;
    if (!track || !element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  const name = participant.name || participant.identity;
  return <div className="ob-participant">
    <video ref={video} hidden={!track || track.isMuted} autoPlay playsInline muted={participant.isLocal} className="ob-participant-video" />
    {(!track || track.isMuted) && <span className="ob-initials">{name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>}
    <div className="ob-participant-label"><span>{name}{participant.isLocal ? ' · You' : ''}</span>{!participant.isMicrophoneEnabled && <MicOff />}</div>
  </div>;
}

export function CallMedia({ room }: { room: Room }) {
  const [version, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    const events = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted];
    for (const event of events) room.on(event, update);
    return () => { for (const event of events) room.off(event, update); };
  }, [room]);
  const participants = [room.localParticipant, ...room.remoteParticipants.values()].filter((participant) => !participant.isAgent);
  return <div className="ob-participants" data-version={version}>
    {participants.map((participant) => <ParticipantFrame key={participant.identity} participant={participant} />)}
    {participants.length < 2 && <div className="ob-participant ob-waiting"><span>Waiting for the other person</span></div>}
  </div>;
}

// Audio belongs to the session, so changing visual scenes never unmounts it.
export function CallAudio({ room }: { room: Room }) {
  return <RoomContext.Provider value={room}><RoomAudioRenderer /></RoomContext.Provider>;
}
