import type { RoomAuthorization } from './context';
export type RemoveMediaParticipant = (roomId: string, userId: string) => Promise<void>;
export type MediaRemoval = { roomId: string; userId: string; state: 'active' | 'pending' | 'removed' | 'failed'; attempts: number; admissionExpiresAt: number };
/** No silent guarantee about external media: bounded retries and queryable outcome. */
export class MediaRevocations {
  private entries = new Map<string, { status: MediaRemoval; stop: () => void }>();
  private closed = false;
  private sleeps = new Map<ReturnType<typeof setTimeout>, () => void>();
  constructor(private remove: RemoveMediaParticipant, private retryMs = 1000) {}
  track(scope: RoomAuthorization, admissionExpiresAt = Date.now()) {
    if (this.closed) throw new Error('Media revocation service is stopping.');
    scope.check('read');
    const key = `${scope.roomId}:${scope.userId}`, prior = this.entries.get(key);
    if (prior?.status.state === 'active') { prior.status.admissionExpiresAt = Math.max(prior.status.admissionExpiresAt, admissionExpiresAt); return; }
    if (this.entries.size >= 256) {
      for (const [id, entry] of this.entries) if (['removed', 'failed'].includes(entry.status.state)) { entry.stop(); this.entries.delete(id); }
      if (this.entries.size >= 256) throw new Error('Call capacity reached.');
    }
    const status: MediaRemoval = { roomId: scope.roomId, userId: scope.userId, state: 'active', attempts: 0, admissionExpiresAt };
    const entry = { status, stop: () => {} };
    this.entries.set(key, entry);
    entry.stop = scope.watch(() => { status.state = 'pending'; void this.revoke(status); });
  }
  private async revoke(status: MediaRemoval) {
    let removed = await this.attemptRemoval(status);
    // A previously issued JWT may reconnect until its admission window closes. Sweep again
    // after expiry + clock margin, and report pending until then. Never claim instant JWT revocation.
    if (status.admissionExpiresAt > Date.now() && !this.closed) {
      await this.sleep(status.admissionExpiresAt - Date.now() + 2000);
      if (this.closed) return;
      removed = await this.attemptRemoval(status);
    }
    status.state = removed ? 'removed' : 'failed';
    if (!removed) console.error('Media removal failed; inspect owner-visible media status.');
  }
  private sleep(ms: number) {
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.sleeps.delete(timer); resolve(); }, ms);
      timer.unref(); this.sleeps.set(timer, resolve);
    });
  }
  private async attemptRemoval(status: MediaRemoval) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.closed) return false;
      status.attempts++;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.remove(status.roomId, status.userId), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Media removal timeout')), 5000); deadline.unref(); })]);
        return true;
      } catch { /* Retry below; do not claim external disconnection. */ }
      finally { clearTimeout(deadline); }
      if (attempt < 2) await this.sleep(this.retryMs);
    }
    return false;
  }
  status(roomId: string) { return [...this.entries.values()].filter(e => e.status.roomId === roomId).map(e => ({ ...e.status })); }
  close() {
    this.closed = true;
    for (const entry of this.entries.values()) entry.stop(); this.entries.clear();
    for (const [timer, resolve] of this.sleeps) { clearTimeout(timer); resolve(); } this.sleeps.clear();
  }
}
