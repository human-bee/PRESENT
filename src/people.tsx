import { useEffect, useState } from 'react';
import type { Participant } from '../shared/room';
import { TrackVideo } from './media/media-elements';
import type { useMedia } from './media/use-media';

export function People({ participants, selfId, media, place }: { participants: Participant[]; selfId: string; media: ReturnType<typeof useMedia>; place: (id: string, name: string, kind: 'participant' | 'screen-share') => void }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('present:hide-people') === 'true'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('present:hide-people', String(hidden)); } catch {} }, [hidden]);
  return <section className="people" aria-label="People in this room">
    <button type="button" className="people-visibility" aria-label={hidden ? 'Show people previews' : 'Hide people previews'} title={hidden ? 'Show people previews' : 'Hide people previews'} aria-expanded={!hidden} onClick={() => setHidden(!hidden)}>{hidden ? 'People' : '−'}</button>
    {!hidden && participants.map(person => {
      const video = media.participants.find(p => p.id === person.id);
      return <button type="button" onClick={() => { place(person.id, person.name, 'participant'); setHidden(true); }} title={`Place ${person.name}'s camera on the canvas`} aria-label={`Place ${person.name}'s camera on the canvas`} key={person.id} className={`person${video?.camera ? ' has-video' : ''}${video?.speaking ? ' speaking' : ''}`} style={{ '--person-color': person.color } as React.CSSProperties}>
        {video?.stream && video.camera ? <TrackVideo stream={video.stream} mirrored={video.isLocal}/> : <span className="person-initial">{person.name.slice(0, 1).toUpperCase()}</span>}
        <span className="person-name">{person.id === selfId ? 'You' : person.name}</span>
      </button>;
    })}
    {!hidden && media.participants.filter(p => p.screenStream).map(person => <button type="button" onClick={() => place(person.id, person.name, 'screen-share')} title="Place screen on canvas" className="screen-tile" key={`screen-${person.id}`}><TrackVideo stream={person.screenStream}/><span>{person.name}’s screen</span></button>)}
  </section>;
}
