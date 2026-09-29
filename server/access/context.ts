import { hostedWorkAuthorizationReady } from './work-authorization';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RoomPermission } from '../../shared/room-access';
import { AccessError, type RoomAccess } from './store';
import { watchAuthorization } from './http';

export type RoomAuthorization = { roomId: string; userId: string; check: (permission?: RoomPermission) => ReturnType<RoomAccess['authorize']>; watch: (cancel: () => void) => () => void };
const context = new AsyncLocalStorage<RoomAuthorization>();
let enforced = false;
export function enforceRoomAuthorization(value: boolean) { enforced = value; }
export function inviteAuthorizationEnforced() { return enforced; }
export function roomAuthorization() { return context.getStore(); }
export function requireRoomAuthorization(roomId: string, permission: RoomPermission = 'read') {
  if (!enforced) return undefined;
  const scope = context.getStore();
  if (!scope || scope.roomId !== roomId) throw new AccessError('This operation has no authorization for this room.');
  return scope.check(permission);
}
export function createRoomAuthorization(access: RoomAccess, token: string, roomId: string): RoomAuthorization {
  const grant = access.authorize(token, roomId, 'read');
  return { roomId, userId: grant.userId, check: (permission = 'read') => access.authorize(token, roomId, permission), watch: cancel => watchAuthorization(access, token, roomId, cancel) };
}
export function withRoomAuthorization<T>(scope: RoomAuthorization | undefined, operation: () => T): T { return context.run(scope!, operation); }
/** Capture at enqueue, invoke at execution. NEVER capture inside a shared drain/timer callback. */
export function captureRoomAuthorization() {
  const scope = context.getStore();
  return <T>(operation: () => T): T => withRoomAuthorization(scope, operation);
}
export function hostedUnavailable(feature: string) {
  if (enforced && !hostedWorkAuthorizationReady()) throw new AccessError(`${feature} is unavailable in the invite profile until its background authorization adapter is installed.`, 503);
}
