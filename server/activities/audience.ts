import { grant, reduceAudience } from './audience-transitions';
import { readYouTubeChat } from './audience-source';
export { readYouTubeChat } from './audience-source';

import type { Activity, ActivityCommand } from '../../shared/activity';
import { retainAudience } from '../../shared/audience';

import { ActivityAuthority } from './authority';
type Access = {
  read: (roomId: string) => Activity[];
  update: (roomId: string, activityId: string, update: (a: Activity) => void) => void;
};

export class AudienceCoordinator {
  private sessions = new Map<
    string,
    {
      proof: string;
      controller: AbortController;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  constructor(
    private access: Access,
    private readPage = readYouTubeChat,
    private authority = new ActivityAuthority(),
  ) {}
  reduce(roomId: string, a: Activity, command: ActivityCommand, actor: string, requestId: string) {
    return reduceAudience(roomId, a, command, actor, requestId, this.authority);
  }
  afterAction(roomId: string) {
    if (this.closed) return;
    for (const a of this.access.read(roomId)) {
      const key = `${roomId}:${a.id}`,
        c = a.audience.connection,
        session = this.sessions.get(key);
      if (!c || ['off', 'failed', 'ended'].includes(c.status)) {
        if (session) {
          session.controller.abort();
          clearTimeout(session.timer);
          this.sessions.delete(key);
        }
        continue;
      }
      if (session && session.proof !== c.proof) {
        session.controller.abort();
        clearTimeout(session.timer);
        this.sessions.delete(key);
      }
      if ((session && session.proof === c.proof) || !this.authority.verify(grant(roomId, a.id, c), c.proof)) continue;
      if (this.sessions.size >= 4) {
        this.access.update(roomId, a.id, (next) => {
          if (next.audience.connection) {
            next.audience.connection.status = 'failed';
            next.audience.connection.error = 'Four audience feeds are already connected.';
          }
        });
        continue;
      }
      const current = { proof: c.proof, controller: new AbortController() } as {
        proof: string;
        controller: AbortController;
        timer?: ReturnType<typeof setTimeout>;
      };
      this.sessions.set(key, current);
      const poll = async () => {
        const currentActivity = this.access.read(roomId).find((v) => v.id === a.id),
          connection = currentActivity?.audience.connection;
        if (!connection || !['connecting', 'connected'].includes(connection.status) || connection.proof !== c.proof) {
          this.sessions.delete(key);
          return;
        }
        try {
          const page = await this.readPage(
            connection,
            AbortSignal.any([current.controller.signal, AbortSignal.timeout(20000)]),
          );
          if (current.controller.signal.aborted || this.closed) return;
          this.access.update(roomId, a.id, (next) => {
            const nextConnection = next.audience.connection;
            if (!nextConnection || nextConnection.proof !== c.proof || nextConnection.status === 'off') return;
            const ids = new Set(next.audience.comments.map((c) => c.id));
            for (const comment of page.comments)
              if (!ids.has(comment.id) && !next.audience.blockedAuthors.includes(comment.authorId)) {
                next.audience.comments.push(comment);
                ids.add(comment.id);
              }
            retainAudience(next.audience);
            Object.assign(nextConnection, {
              cursor: page.cursor,
              lastAt: Date.now(),
              nextAt: Date.now() + page.nextMs,
              status: page.ended ? 'ended' : 'connected',
              error: null,
            });
          });
          if (!page.ended) {
            current.timer = setTimeout(() => void poll(), page.nextMs);
            current.timer.unref();
          } else this.sessions.delete(key);
        } catch (error) {
          if (!current.controller.signal.aborted && !this.closed)
            this.access.update(roomId, a.id, (next) => {
              const target = next.audience.connection;
              if (target?.proof === c.proof) {
                target.status = 'failed';
                target.error = String(error instanceof Error ? error.message : 'Audience feed failed.').slice(0, 250);
              }
            });
          this.sessions.delete(key);
        }
      };
      void poll();
    }
  }
  close() {
    this.closed = true;
    for (const s of this.sessions.values()) {
      s.controller.abort();
      clearTimeout(s.timer);
    }
    this.sessions.clear();
  }
}
