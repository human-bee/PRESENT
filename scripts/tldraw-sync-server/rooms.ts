import { TLSocketRoom, type RoomSnapshot } from '@tldraw/sync-core';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

const ROOM_DIR = resolve('.tldraw-local/rooms');

interface RoomState {
  room: TLSocketRoom<any, void>;
  id: string;
  needsPersist: boolean;
}

const rooms = new Map<string, RoomState>();
let mutex: Promise<Error | null> = Promise.resolve(null);

async function readSnapshot(roomId: string): Promise<RoomSnapshot | undefined> {
  try {
    const buffer = await readFile(join(ROOM_DIR, roomId));
    return JSON.parse(buffer.toString()) as RoomSnapshot;
  } catch {
    return undefined;
  }
}

async function writeSnapshot(roomId: string, snapshot: RoomSnapshot) {
  await mkdir(ROOM_DIR, { recursive: true });
  await writeFile(join(ROOM_DIR, roomId), JSON.stringify(snapshot));
}

export async function makeOrLoadRoom(roomId: string) {
  mutex = mutex
    .then(async () => {
      const existing = rooms.get(roomId);
      if (existing && !existing.room.isClosed()) {
        return null;
      }

      const initialSnapshot = await readSnapshot(roomId);
      const roomState: RoomState = {
        room: new TLSocketRoom({
          initialSnapshot,
          onSessionRemoved(room, { sessionId, numSessionsRemaining }) {
            room.log?.debug?.('session removed', { sessionId, numSessionsRemaining });
            if (numSessionsRemaining === 0) {
              room.close();
            }
          },
          onDataChange() {
            roomState.needsPersist = true;
          },
        }),
        id: roomId,
        needsPersist: false,
      };

      rooms.set(roomId, roomState);
      return null;
    })
    .catch((error) => error as Error);

  const err = await mutex;
  if (err) throw err;
  return rooms.get(roomId)!.room;
}

setInterval(() => {
  for (const roomState of rooms.values()) {
    if (roomState.needsPersist) {
      roomState.needsPersist = false;
      const snapshot = roomState.room.getCurrentSnapshot();
      void writeSnapshot(roomState.id, snapshot).catch((error) =>
        console.warn('[tldraw-sync] failed to persist snapshot', error),
      );
    }
    if (roomState.room.isClosed()) {
      rooms.delete(roomState.id);
    }
  }
}, 2000);
