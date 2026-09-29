import type { RoomGrant, RoomInvite } from '../../shared/room-access';

/** A transport failure is not proof that a signed room grant was revoked. */
export class RoomAccessError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
async function request<T>(path: string, method = 'POST', data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/access/${path}`, { method, signal, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new RoomAccessError(response.status, typeof value?.error === 'string' ? value.error : 'Room access failed.');
  if (!value) throw new Error('The room returned an invalid response.');
  return value as T;
}
export const roomAccessClient = {
  session: () => request<{ userId: string; expiresAt: number }>('session'),
  create: () => request<RoomGrant>('rooms'),
  join: (token: string) => request<RoomGrant>('join', 'POST', { token }),
  get: (roomId: string, signal?: AbortSignal) => request<RoomGrant>(`rooms/${roomId}`, 'GET', undefined, signal),
  leave: (roomId: string) => request(`rooms/${roomId}/leave`),
  invite: (roomId: string, role: 'editor' | 'viewer') => request<RoomInvite>(`rooms/${roomId}/invites`, 'POST', { role, ttlMs: 86400_000, maxUses: 1 }),
  revokeInvite: (roomId: string, id: string) => request(`rooms/${roomId}/invites/${id}`, 'DELETE'),
  revokeMember: (roomId: string, userId: string) => request(`rooms/${roomId}/members/${userId}`, 'DELETE'),
};
