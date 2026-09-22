import { useState } from 'react';
import type { RoomGrant, RoomInvite } from '../../shared/room-access';

async function request<T>(path: string, method = 'POST', data?: unknown): Promise<T> {
  const response = await fetch(`/api/access/${path}`, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Room access failed.');
  return value as T;
}
export const roomAccessClient = {
  session: () => request<{ userId: string; expiresAt: number }>('session'),
  create: () => request<RoomGrant>('rooms'),
  join: (token: string) => request<RoomGrant>('join', 'POST', { token }),
  get: (roomId: string) => request<RoomGrant>(`rooms/${roomId}`, 'GET'),
  leave: (roomId: string) => request(`rooms/${roomId}/leave`),
  invite: (roomId: string, role: 'editor' | 'viewer') => request<RoomInvite>(`rooms/${roomId}/invites`, 'POST', { role, ttlMs: 86400_000, maxUses: 1 }),
  revokeInvite: (roomId: string, id: string) => request(`rooms/${roomId}/invites/${id}`, 'DELETE'),
  revokeMember: (roomId: string, userId: string) => request(`rooms/${roomId}/members/${userId}`, 'DELETE'),
};
/** Call once before mounting analytics or the room app. Tokens stay out of server URLs and storage. */
export function takeRoomInvite(location: Location = window.location, history: History = window.history): string {
  const token = new URLSearchParams(location.hash.slice(1)).get('invite') ?? '';
  if (token) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return token;
}
export function JoinRoom({ initialInvite = '', onJoined }: { initialInvite?: string; onJoined: (grant: RoomGrant) => void }) {
  const [input, setInput] = useState(initialInvite), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function enter(create: boolean) {
    setBusy(true); setError('');
    try {
      await roomAccessClient.session();
      let token = input.trim();
      if (token.includes('://')) token = new URLSearchParams(new URL(token).hash.slice(1)).get('invite') ?? '';
      const grant = create ? await roomAccessClient.create() : await roomAccessClient.join(token);
      setInput(''); onJoined(grant);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to join.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Join room"><h2>Join a room</h2><form onSubmit={event => { event.preventDefault(); void enter(false); }}>
    <label>Room invitation <input value={input} onChange={event => setInput(event.target.value)} placeholder="Paste your room link" autoComplete="off" /></label>
    <button disabled={busy || !input.trim()}>Join room</button>
  </form><button disabled={busy} onClick={() => void enter(true)}>Create a room</button><p role="status">{busy ? 'Opening room…' : error}</p></section>;
}
export function InviteRoom({ grant }: { grant: RoomGrant }) {
  const [role, setRole] = useState<'editor' | 'viewer'>('editor'), [invite, setInvite] = useState<RoomInvite>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (grant.role !== 'owner') return null;
  const link = invite ? `${window.location.origin}/#invite=${encodeURIComponent(invite.token)}` : '';
  async function act(revoke: boolean) {
    setBusy(true); setError('');
    try {
      if (revoke && invite) { await roomAccessClient.revokeInvite(grant.roomId, invite.id); setInvite(undefined); }
      else setInvite(await roomAccessClient.invite(grant.roomId, role));
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to update invite.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Invite to room"><h3>Invite someone</h3>
    <label>Can <select value={role} onChange={event => setRole(event.target.value as 'editor' | 'viewer')}><option value="editor">edit</option><option value="viewer">view</option></select></label>
    <button disabled={busy || !!invite} onClick={() => void act(false)}>Create invite</button>
    {invite && <><label>Room link <input readOnly value={link} onFocus={event => event.target.select()} /></label><p>One person · valid for 24 hours</p><button disabled={busy} onClick={() => void act(true)}>Revoke invite and its access</button></>}
    <p role="status">{error}</p></section>;
}
