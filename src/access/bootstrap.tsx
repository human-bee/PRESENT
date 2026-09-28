import { useEffect, useState } from 'react';
import { App } from '../app';
import { Playbook } from '../playbook/playbook';
import type { RoomGrant } from '../../shared/room-access';
import { JoinRoom, roomAccessClient, takeRoomInvite } from './room-access';
import { setSignedParticipant } from '../identity';
import './room-access.css';
const initialInvite = takeRoomInvite();
export function AccessApp() {
  const [profile, setProfile] = useState<'local' | 'invite'>(), [grant, setGrant] = useState<RoomGrant>();
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const admit = (value: RoomGrant) => { setSignedParticipant(value.userId); history.replaceState({}, '', `/r/${value.roomId}`); setGrant(value); setError(''); };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/profile'); if (!response.ok) throw new Error('Unable to load the room profile.');
        const result = await response.json();
        if (!active) return;
        if (!['local', 'invite'].includes(result.profile)) throw new Error('Invalid server profile.');
        setProfile(result.profile);
        const id = /^\/r\/([a-f0-9]{48})$/.exec(location.pathname)?.[1];
        if (result.profile === 'invite' && id && !initialInvite) {
          const value = await roomAccessClient.get(id);
          if (active) admit(value);
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Room unavailable.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!grant) return;
    const events = new EventSource(`/api/access/rooms/${grant.roomId}/events`);
    const end = () => { events.close(); setGrant(undefined); setSignedParticipant(undefined); setError('Your room access has ended. Ask the owner for help.'); };
    events.addEventListener('ended', end);
    events.onerror = () => { void roomAccessClient.get(grant.roomId).catch(end); };
    return () => events.close();
  }, [grant]);
  if (loading) return <main className="access-entry" role="status">Opening PRESENT…</main>;
  if (profile === 'local') return location.pathname === '/playbook' ? <Playbook/> : <App/>;
  if (profile === 'invite' && grant) return <App key={grant.roomId} accessGrant={grant} onAccessLeave={() => { setGrant(undefined); history.replaceState({}, '', '/'); }} onRoomOpen={async roomId => admit(await roomAccessClient.get(roomId))}/>;
  return <main className="access-entry"><div className="access-card"><img src="/mark.svg" alt=""/><h1>Make room.</h1><p>A shared canvas for your people.</p>{error && <p role="alert">{error}</p>}{profile === 'invite' ? <JoinRoom initialInvite={initialInvite} onJoined={admit}/> : <button onClick={() => location.reload()}>Try again</button>}</div></main>;
}
