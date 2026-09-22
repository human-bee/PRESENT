import { Track, type Participant, type Room } from 'livekit-client';

export type MediaParticipant = {
  id: string;
  name: string;
  isLocal: boolean;
  stream?: MediaStream;
  screenStream?: MediaStream;
  speaking: boolean;
  mic: boolean;
  camera: boolean;
};

export type MediaState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error: string | null;
  mic: boolean;
  camera: boolean;
  screen: boolean;
  participants: MediaParticipant[];
};

export const emptyMediaState = (): MediaState => ({
  status: 'idle', error: null, mic: false, camera: false, screen: false, participants: [],
});

export function sourceActive(person: Participant, source: Track.Source): boolean {
  const publication = person.getTrackPublication(source);
  return Boolean(publication && !publication.isMuted && publication.track?.mediaStreamTrack.readyState === 'live');
}

const streams = new WeakMap<Participant, { person: MediaStream; screen: MediaStream }>();

function participantState(person: Participant, localId: string): MediaParticipant {
  let pair = streams.get(person);
  if (!pair) {
    pair = { person: new MediaStream(), screen: new MediaStream() };
    streams.set(person, pair);
  }
  const personTracks: MediaStreamTrack[] = [];
  const screenTracks: MediaStreamTrack[] = [];
  for (const publication of person.trackPublications.values()) {
    const track = publication.track?.mediaStreamTrack;
    if (!track || publication.isMuted || track.readyState === 'ended') continue;
    const isScreen = publication.source === Track.Source.ScreenShare || publication.source === Track.Source.ScreenShareAudio;
    (isScreen ? screenTracks : personTracks).push(track);
  }
  for (const [stream, tracks] of [[pair.person, personTracks], [pair.screen, screenTracks]] as const) {
    for (const track of stream.getTracks()) if (!tracks.includes(track)) stream.removeTrack(track);
    for (const track of tracks) if (!stream.getTracks().includes(track)) stream.addTrack(track);
  }
  return {
    id: person.identity, name: person.name || 'Guest', isLocal: person.identity === localId,
    stream: personTracks.length ? pair.person : undefined,
    screenStream: screenTracks.length ? pair.screen : undefined,
    speaking: person.isSpeaking,
    mic: person.identity === localId ? sourceActive(person, Track.Source.Microphone) : person.isMicrophoneEnabled,
    camera: person.identity === localId ? sourceActive(person, Track.Source.Camera) : person.isCameraEnabled,
  };
}

export function participantsFor(room: Room): MediaParticipant[] {
  return [room.localParticipant, ...room.remoteParticipants.values()]
    .map((participant) => participantState(participant, room.localParticipant.identity));
}

export function mediaError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return 'Device permission was declined. You can try again whenever you are ready.';
    if (error.name === 'NotFoundError') return 'No matching microphone or camera was found.';
    if (error.name === 'NotReadableError') return 'That device is busy or unavailable. Check other apps and try again.';
    return error.message;
  }
  return 'The call could not connect. Please try again.';
}
