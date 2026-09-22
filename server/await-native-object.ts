import { getRoom, subscribeRoom } from './room-store';

type Subscribe = (roomId: string, listener: Parameters<typeof subscribeRoom>[1]) => () => void;

/** Native sync and the widget bridge are separate transports into the same document.
 * A first interaction may reach HTTP just before its native creation reaches sync. */
export function createAwaitNativeObject(readRoom: typeof getRoom = getRoom, subscribe: Subscribe = subscribeRoom) {
  return async (roomId: string, objectId: string, signal: AbortSignal): Promise<void> => {
    // The DTO operation adapter accepts either an object ID or its native shape ID.
    const id = objectId.replace(/^shape:/, '');
    const exists = () => readRoom(roomId).objects.some(object => object.id === id);
    if (signal.aborted || exists()) return;
    await new Promise<void>((resolve, reject) => {
      let unsubscribe: (() => void) | undefined, finished = false;
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true; clearTimeout(timer); unsubscribe?.(); signal.removeEventListener('abort', onAbort);
        if (error === undefined) resolve(); else reject(error);
      };
      const onAbort = () => finish();
      const timer = setTimeout(onAbort, 1000);
      try {
        unsubscribe = subscribe(roomId, room => { if (room.objects.some(object => object.id === id)) finish(); });
        if (finished) unsubscribe();
        else {
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted || exists()) finish();
        }
      } catch (error) { finish(error); }
    });
  };
}
export const awaitNativeObject = createAwaitNativeObject();
