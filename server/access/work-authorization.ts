import { AccessError } from './store';
import { roomAuthorization, withRoomAuthorization, inviteAuthorizationEnforced, type RoomAuthorization } from './context';
let integrated = false;
/** Coordinator calls only after adding all enqueue/drain/commit/resume hooks below. */
export function enableHostedWorkAuthorization() { integrated = true; }
export function hostedWorkAuthorizationReady() { return integrated; }
/** Memory only. Restored jobs have no credential; explicit authorized resume is required. */
export class WorkAuthorizations {
  private jobs = new Map<string, RoomAuthorization | undefined>();
  capture(jobId: string, roomId: string, actor: string) {
    const scope = roomAuthorization();
    if (inviteAuthorizationEnforced() && !scope) throw new AccessError('Missing initiating room authorization.');
    if (scope && (scope.roomId !== roomId || scope.check('tools').userId !== actor)) throw new AccessError('Work identity must match the signed room member.');
    for (const [id, prior] of this.jobs) if (prior) { try { prior.check('tools'); } catch { this.jobs.delete(id); } }
    if (!this.jobs.has(jobId) && this.jobs.size >= 1000) throw new AccessError('Work authorization capacity reached.', 503);
    this.jobs.set(jobId, scope);
  }
  async run<T>(jobId: string, roomId: string, actor: string, controller: AbortController, execute: () => Promise<T>): Promise<T> {
    if (!this.jobs.has(jobId)) throw new AccessError('Resume this job explicitly to authorize execution.');
    const scope = this.jobs.get(jobId);
    if (inviteAuthorizationEnforced() && !scope) throw new AccessError('Resume explicitly with room authorization.');
    if (scope && (scope.roomId !== roomId || scope.check('tools').userId !== actor)) throw new AccessError('Work authorization ended.');
    const stop = scope?.watch(() => controller.abort());
    try { return await withRoomAuthorization(scope, execute); }
    finally { stop?.(); }
  }
  forget(jobId: string) { this.jobs.delete(jobId); }
  close() { this.jobs.clear(); }
}
export const workAuthorizations = new WorkAuthorizations();
