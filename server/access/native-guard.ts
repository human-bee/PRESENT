import { RoomStore } from '../room-store';
import { enforceRoomAuthorization, requireRoomAuthorization, roomAuthorization, withRoomAuthorization } from './context';

/** Install once before dispatch. Decorate the application's own public store boundary, preserving
 * the coordinator-owned persistence/cache implementation. No native/vendor internals are patched.
 * Even providers holding exported store functions are checked at their eventual read/commit.
 */
export function installNativeAccessGuard() {
  enforceRoomAuthorization(true);
  const prototype = RoomStore.prototype;
  const originals = new Map<string, PropertyDescriptor>();
  const methods = { getRoom: 'read', getRoomSnapshot: 'read', getCanvasRecords: 'read', getTldrawRoom: 'read', subscribeRoom: 'read', applyOperation: 'write', mutateCanvas: 'write', transactCanvas: 'write' } as const;
  for (const [method, permission] of Object.entries(methods)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method)!;
    originals.set(method, descriptor);
    Object.defineProperty(prototype, method, { ...descriptor, value: function(this: RoomStore, roomId: string, ...args: unknown[]) {
      const grant = requireRoomAuthorization(roomId, permission);
      if (method === 'subscribeRoom') {
        const scope = roomAuthorization()!;
        const listener = args[0] as (...events: unknown[]) => void;
        args[0] = (...events: unknown[]) => withRoomAuthorization(scope, () => { scope.check('read'); listener(...events); });
        const unsubscribe = descriptor.value.call(this, roomId, ...args) as () => void;
        const unwatch = scope.watch(unsubscribe);
        return () => { unwatch(); unsubscribe(); };
      }
      // Never preserve caller-supplied actor identity in server mutation audit events.
      if (grant && permission === 'write') args[1] = grant.userId;
      return descriptor.value.call(this, roomId, ...args);
    } });
  }
  return () => { for (const [name, descriptor] of originals) Object.defineProperty(prototype, name, descriptor); enforceRoomAuthorization(false); };
}
