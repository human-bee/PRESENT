import { useEffect, useReducer } from 'react';
import type { RoomObject } from '../../shared/room';
import { readMediaReference } from '../../shared/media-reference';
import { Icon } from '../icons';
import { TrackVideo } from './media-elements';
import { useCanvasMedia } from './media-context';

function useLiveVideo(stream?: MediaStream): boolean {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!stream) return;
    const observed = new Set<MediaStreamTrack>();
    const changed = () => {
      for (const track of stream.getVideoTracks()) if (!observed.has(track)) {
        observed.add(track);
        for (const event of ['ended', 'mute', 'unmute']) track.addEventListener(event, refresh);
      }
      refresh();
    };
    for (const event of ['addtrack', 'removetrack']) stream.addEventListener(event, changed);
    changed();
    return () => {
      for (const event of ['addtrack', 'removetrack']) stream.removeEventListener(event, changed);
      for (const track of observed) for (const event of ['ended', 'mute', 'unmute']) track.removeEventListener(event, refresh);
    };
  }, [stream]);
  return stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted) ?? false;
}

const videoStyle = '.canvas-media-frame{position:absolute;inset:0}.canvas-media-frame video{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none}.canvas-media-screen video{object-fit:contain}';

export function CanvasMediaView({ object }: { object: RoomObject }) {
  const media = useCanvasMedia(), reference = readMediaReference(object.data);
  const person = reference ? media?.participants.find(person => person.id === reference.participantId) : undefined;
  const isScreen = reference?.capability === 'screen-share';
  const stream = isScreen ? person?.screenStream : person?.stream;
  const hasVideo = useLiveVideo(stream);
  const displayName = person?.name || reference?.name || 'Someone';
  const label = reference ? `${person?.isLocal ? 'Your' : `${displayName}’s`} ${isScreen ? 'screen' : 'camera'}` : 'Unavailable media tile';
  const showing = Boolean(reference && media?.status === 'connected' && hasVideo && (isScreen || person?.camera));
  let unavailable = isScreen ? 'No screen share is available.' : 'Camera is off or unavailable.';
  if (!reference) unavailable = 'This tile has no valid participant reference.';
  else if (!media || media.status === 'idle') unavailable = 'Join the call to view this tile.';
  else if (media.status === 'connecting') unavailable = 'Connecting to the call…';
  else if (media.status === 'error') unavailable = 'Call connection unavailable.';
  else if (!person) unavailable = `${displayName} is not connected to the call.`;

  return <section aria-label={label} data-media-capability={reference?.capability} data-participant-id={reference?.participantId}
    style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', borderRadius: 'inherit', background: '#1f2824', color: '#fffef9' }}>
    <style>{videoStyle}</style>
    {showing ? <div className={`canvas-media-frame${isScreen ? ' canvas-media-screen' : ''}`}>
      <TrackVideo stream={stream} mirrored={Boolean(person?.isLocal && !isScreen)} />
    </div> : <div style={{ display: 'flex', height: '100%', padding: '28px 24px 52px', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
      <span aria-hidden="true" style={{ opacity: .5 }}><Icon name={isScreen ? 'screen' : 'camera'} size={28} /></span>
      <p role="status" style={{ margin: 0, maxWidth: 290, fontSize: 14, lineHeight: 1.5, color: '#c6d1c7' }}>{unavailable}</p>
    </div>}
    <div style={{ position: 'absolute', inset: 'auto 0 0', padding: '20px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'linear-gradient(transparent, #122018cc)', pointerEvents: 'none' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{person?.isLocal ? `${displayName} (you)` : displayName}</span>
      <span style={{ fontSize: 11, opacity: .7, whiteSpace: 'nowrap' }}>{isScreen ? 'Screen' : 'Camera'}</span>
    </div>
  </section>;
}
