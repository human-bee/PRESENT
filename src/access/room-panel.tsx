import { useEffect, useState } from 'react';
import type { RoomGrant } from '../../shared/room-access';
import { TemplatePicker } from '../templates/template-picker';
import { InviteRoom, roomAccessClient } from './room-access';
type Member = { userId: string; role: string; revoked: boolean };
type Invitation = { id: string; role: string; revoked: boolean; uses: number };
export function RoomPanel({ grant, roomId, onOpen, onLeave, close }: { grant?: RoomGrant; roomId: string; onOpen: (id: string) => void | Promise<void>; onLeave: () => void; close: () => void }) {
  const [members, setMembers] = useState<Member[]>([]), [invites, setInvites] = useState<Invitation[]>([]), [message, setMessage] = useState('');
  const owner = grant?.role === 'owner';
  async function refresh() {
    if (!owner) return;
    const [m, i] = await Promise.all([fetch(`/api/access/rooms/${roomId}/members`), fetch(`/api/access/rooms/${roomId}/invites`)]);
    if (!m.ok || !i.ok) throw new Error('Unable to load room access.');
    setMembers(await m.json()); setInvites(await i.json());
  }
  useEffect(() => { void refresh().catch(e => setMessage(e.message)); }, [roomId, owner]);
  async function run(action: () => Promise<unknown>) {
    try { await action(); await refresh(); setMessage('Room access updated. Call removal may still be pending.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to update access.'); }
  }
  return <aside className="access-panel overlay" aria-label="Room panel"><header><h2>Your room</h2><button onClick={close} aria-label="Close room panel">×</button></header>
    {!grant && <button onClick={() => void navigator.clipboard.writeText(`${location.origin}/r/${roomId}`).then(() => setMessage('Room link copied.')).catch(() => setMessage(`${location.origin}/r/${roomId}`))}>Copy room link</button>}
    {grant && <p>{grant.role === 'viewer' ? 'You can view this room and listen to calls.' : `You are the ${grant.role}.`} Session expires {new Date(grant.expiresAt).toLocaleDateString()}.</p>}
    {owner && <><InviteRoom grant={grant}/><details onToggle={event => { if (event.currentTarget.open) void refresh().catch(e => setMessage(e.message)); }}><summary>Manage access</summary>
      <ul>{members.map(member => <li key={member.userId}><span>{member.userId === grant.userId ? 'You' : `Participant ${member.userId.slice(0, 8)}`} · {member.role}{member.revoked ? ' · revoked' : ''}</span>{member.role !== 'owner' && !member.revoked && <button onClick={() => void run(() => roomAccessClient.revokeMember(roomId, member.userId))}>Remove participant</button>}</li>)}</ul>
      <ul>{invites.filter(i => !i.revoked).map(i => <li key={i.id}><span>{i.role} invite · {i.uses} joined</span><button onClick={() => void run(() => roomAccessClient.revokeInvite(roomId, i.id))}>Revoke invitation</button></li>)}</ul>
      <button onClick={() => void run(async () => { const response = await fetch(`/api/access/rooms/${roomId}/media`); const states = await response.json(); if (!response.ok) throw new Error('Unable to read call status'); setTimeout(() => setMessage(states.length ? states.map((s: {userId:string;state:string}) => `${s.userId.slice(0,8)}: ${s.state}`).join('; ') : 'No media sessions issued.'), 0); })}>Check call removal</button>
    </details></>}
    <TemplatePicker roomId={roomId} canSave={!grant || owner} onInstalled={id => { void Promise.resolve(onOpen(id)).catch(e => setMessage(e.message)); }}/>
    {grant && !owner && <button onClick={() => void run(async () => { await roomAccessClient.leave(roomId); onLeave(); })}>Leave room</button>}
    <p role="status">{message}</p>
  </aside>;
}
