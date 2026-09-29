import type { RoomGrant } from '../../shared/room-access';
import { RoomAccessError, roomAccessClient } from './client';

type AccessEvents = Pick<EventSource, 'close' | 'onerror'> & { addEventListener(type: string, listener: () => void): void };
/** Keep the canvas mounted during outages. The server still authorizes every operation. */
export function watchRoomAccess(grant: RoomGrant, onEnded: () => void, options: {
  createEvents?: (url: string) => AccessEvents;
  check?: (roomId: string, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: typeof clearTimeout;
} = {}) {
  const events = (options.createEvents ?? (url => new EventSource(url)))(`/api/access/rooms/${grant.roomId}/events`);
  const check = options.check ?? roomAccessClient.get, now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  const lifetime = new AbortController();
  let active = true, checking = false, expiry: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { active = false; lifetime.abort(); events.close(); if (expiry !== undefined) cancel(expiry); };
  const end = () => { if (!active) return; dispose(); onEnded(); };
  const expire = () => {
    const remaining = grant.expiresAt - now();
    if (remaining <= 0) end();
    else expiry = schedule(expire, Math.min(remaining, 86400_000));
  };
  events.addEventListener('ended', end);
  events.onerror = () => {
    if (!active || checking) return;
    checking = true;
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]);
    void check(grant.roomId, signal).catch(error => {
      // EventSource reconnects itself; a timeout, proxy 5xx, or offline fetch is recoverable.
      if (active && error instanceof RoomAccessError && [401, 403].includes(error.status)) end();
    }).finally(() => { checking = false; });
  };
  expire(); // Known expiry must still end the grant even when completely offline.
  return dispose;
}
