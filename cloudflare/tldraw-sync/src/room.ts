import { DurableObject } from 'cloudflare:workers';
import { TLSocketRoom, type RoomSnapshot } from '@tldraw/sync-core';
import { appSchema } from './schema';

export interface Env {
  TLDRAW_UPLOADS: R2Bucket;
  SYNC_ADMIN_TOKEN?: string;
}

export class TldrawRoomDurableObject extends DurableObject<Env> {
  private room: TLSocketRoom<any, void> | null = null;
  private needsPersist = false;
  private loaded = false;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;

    const snapshot = (await this.ctx.storage.get<RoomSnapshot>('snapshot')) ?? undefined;

    this.room = new TLSocketRoom({
      schema: appSchema,
      initialSnapshot: snapshot,
      onSessionRemoved: (room, { numSessionsRemaining }) => {
        if (numSessionsRemaining === 0) {
          try {
            room.close();
          } catch {}
        }
      },
      onDataChange: () => {
        this.needsPersist = true;
        // Debounce writes using a DO alarm.
        void this.ctx.storage.setAlarm(Date.now() + 2000);
      },
    });
  }

  override async alarm() {
    if (!this.needsPersist) return;
    await this.ensureLoaded();
    if (!this.room) return;
    this.needsPersist = false;
    try {
      const snapshot = this.room.getCurrentSnapshot();
      await this.ctx.storage.put('snapshot', snapshot);
    } catch (error) {
      console.warn('[tldraw-sync][alarm] persist failed', error);
      this.needsPersist = true;
      void this.ctx.storage.setAlarm(Date.now() + 5000);
    }
  }

  private async handleConnect(request: Request): Promise<Response> {
    await this.ensureLoaded();
    if (!this.room) return new Response('Room unavailable', { status: 500 });

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId') || crypto.randomUUID();

    // Cloudflare workers WebSocketPair
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.room.handleSocketConnect({ sessionId, socket: server as any });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleReset(): Promise<Response> {
    await this.ensureLoaded();
    try {
      this.room?.close();
    } catch {}
    this.room = null;
    this.needsPersist = false;
    await this.ctx.storage.delete('snapshot');
    this.loaded = false;
    return Response.json({ ok: true });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/connect')) {
      return this.handleConnect(request);
    }

    if (pathname === '/admin/reset' && request.method === 'POST') {
      return this.handleReset();
    }

    return new Response('Not found', { status: 404 });
  }
}

