import { TLSocketRoom, type RoomSnapshot } from '@tldraw/sync-core';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join, resolve } from 'path';

import { createTLSchema, defaultBindingSchemas, defaultShapeSchemas } from '@tldraw/tlschema';
import { T } from '@tldraw/validate';

const ROOM_DIR = resolve('.tldraw-local/rooms');

interface RoomState {
  room: TLSocketRoom<any, void>;
  id: string;
  needsPersist: boolean;
}

const customShapeProps = {
  w: T.number,
  h: T.number,
  customComponent: T.any,
  name: T.string,
  pinned: T.optional(T.boolean),
  pinnedX: T.optional(T.number),
  pinnedY: T.optional(T.number),
  userResized: T.optional(T.boolean),
  state: T.optional(T.any),
};

const mermaidStreamShapeProps = {
  w: T.number,
  h: T.number,
  name: T.string,
  mermaidText: T.string,
  compileState: T.optional(T.string),
  renderState: T.optional(T.string),
  streamId: T.optional(T.string),
  keepLastGood: T.optional(T.boolean),
};

const toolboxShapeProps = {
  w: T.number,
  h: T.number,
  name: T.string,
};

const appSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    custom: { props: customShapeProps },
    mermaid_stream: { props: mermaidStreamShapeProps },
    toolbox: { props: toolboxShapeProps },
  },
  bindings: defaultBindingSchemas,
});

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
          schema: appSchema,
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

export async function resetRoom(roomId: string) {
  const state = rooms.get(roomId);
  if (state) {
    try {
      state.room.close();
    } catch {}
    rooms.delete(roomId);
  }
  try {
    await unlink(join(ROOM_DIR, roomId));
  } catch {}
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
