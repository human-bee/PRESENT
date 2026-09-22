import { useEffect, useRef, useState } from 'react';
import type { MediaParticipant } from './media-state';

export function TrackVideo({ stream, className, mirrored = false }: {
  stream?: MediaStream; className?: string; mirrored?: boolean;
}) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = element.current;
    if (!video) return;
    video.srcObject = stream ?? null;
    if (stream) void video.play().catch(() => { /* Muted inline video can resume when foregrounded. */ });
    return () => { video.srcObject = null; };
  }, [stream]);
  return <video ref={element} className={className} autoPlay playsInline muted
    style={mirrored ? { transform: 'scaleX(-1)' } : undefined} />;
}

function RemoteAudio({ stream, register }: {
  stream: MediaStream; register: (element: HTMLAudioElement, blocked: boolean) => void;
}) {
  const element = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = element.current;
    if (!audio) return;
    let active = true;
    audio.srcObject = stream;
    void audio.play().then(() => { if (active) register(audio, false); })
      .catch(() => { if (active) register(audio, true); });
    return () => { active = false; register(audio, false); audio.srcObject = null; };
  }, [stream, register]);
  // biome-ignore lint/a11y/useMediaCaption: Live WebRTC audio has no prerecorded caption file.
  return <audio ref={element} autoPlay />;
}

export function RoomAudio({ participants }: { participants: MediaParticipant[] }) {
  const blocked = useRef(new Set<HTMLAudioElement>());
  const [needsGesture, setNeedsGesture] = useState(false);
  const [register] = useState(() => (element: HTMLAudioElement, value: boolean) => {
    if (value) blocked.current.add(element); else blocked.current.delete(element);
    setNeedsGesture(blocked.current.size > 0);
  });
  const resume = () => {
    for (const audio of blocked.current) void audio.play().then(() => register(audio, false)).catch(() => {});
  };
  return <>
    {participants.filter((person) => !person.isLocal).flatMap((person) => [
      person.stream && <RemoteAudio key={`${person.id}-voice`} stream={person.stream} register={register} />,
      person.screenStream && <RemoteAudio key={`${person.id}-screen`} stream={person.screenStream} register={register} />,
    ])}
    {needsGesture && <button type="button" className="audio-permission" onClick={resume}>Enable call audio</button>}
  </>;
}
