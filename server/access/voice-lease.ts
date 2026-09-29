import { roomAuthorization } from './context';
import { AccessError } from './store';
const leases = new Map<string, () => void>();
/** Server ownership ends even when a revoked browser ignores the membership SSE event. */
export function retainVoiceAuthorization(roomId: string, sessionId: string, stopVoice: () => void) {
  const scope = roomAuthorization(); if (!scope) return;
  scope.check('tools');
  const key = `${roomId}:${sessionId}`;
  releaseVoiceAuthorization(roomId, sessionId);
  if (leases.size >= 128) throw new AccessError('Voice session capacity reached.', 503);
  const cleanup = scope.watch(() => { leases.delete(key); stopVoice(); });
  leases.set(key, cleanup);
}
export function releaseVoiceAuthorization(roomId: string, sessionId: string) {
  const key = `${roomId}:${sessionId}`; leases.get(key)?.(); leases.delete(key);
}
export function closeVoiceAuthorizations() { for (const stop of leases.values()) stop(); leases.clear(); }
