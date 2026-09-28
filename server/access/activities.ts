import { startWork, getWork, cancelWork } from '../agents/work-jobs';
import { ActivityEngine, activityEngine } from '../activities/engine';
import { ActivityAuthority } from '../activities/authority';
import { fetchLinearProfile } from '../activities/linear';
import { roomAuthorization, hostedUnavailable, withRoomAuthorization } from './context';
import { AccessError } from './store';

// One scheduler per initiating identity AND room: shared timer/drain closures cannot inherit
// the identity of the first unrelated request. No credential is persisted in activity records.
const engines = new Map<string, { engine: ActivityEngine; stop: () => void }>();
export function authorizedActivityEngine() {
  const scope = roomAuthorization();
  if (!scope) return activityEngine;
  scope.check('read');
  const key = `${scope.roomId}:${scope.userId}`, existing = engines.get(key);
  if (existing) return existing.engine;
  if (engines.size >= 128) throw new AccessError('Activity capacity reached.', 503);

  const engine = new ActivityEngine(undefined, {}, { start: (...args) => { hostedUnavailable('Selected-project work'); return startWork(...args); }, get: (...args) => { hostedUnavailable('Selected-project work'); return getWork(...args); }, cancel: (...args) => { hostedUnavailable('Selected-project work'); return cancelWork(...args); }, profile: fetchLinearProfile, authority: new ActivityAuthority() });
  const stop = scope.watch(() => { withRoomAuthorization(scope, () => engine.close()); engines.delete(key); });
  engines.set(key, { engine, stop });
  return engine;
}
export function closeAuthorizedActivities() { for (const { engine, stop } of engines.values()) { stop(); engine.close(); } engines.clear(); }
