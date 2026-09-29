# Coordinator: per-job authorization adapter

`server/agents/work-jobs.ts` is coordinator-owned and deliberately absent from this patch. Keep Terra's private project snapshots, stable workspace continuation, request idempotency and bounded diff evidence. The new helper `server/access/work-authorization.ts` captures a memory-only authorization capability **per job**; it does not persist cookies in jobs or project snapshots.

The shared `drain()` chain invokes later jobs from a previous Promise's `finally`. Ambient AsyncLocalStorage at that point is the wrong authority. Do not capture context in drain or simply reuse a global/shared timer context.

## Imports and start/resume

```ts
import { workAuthorizations } from '../access/work-authorization';
import { requireRoomAuthorization, inviteAuthorizationEnforced } from '../access/context';
```

At the start of public `start`, `resume`, `cancel`, and read/get paths, validate the room before reading private saved-job/project data (`tools` for mutation, `read` for get). Keep the existing `job.actor === actor` checks for cancel/resume and same-card workspace continuation. The HTTP dispatcher already overwrites `actor` with signed identity; direct activity/voice entry points must carry that same identity.

After deriving/validating a **new** job, and before saving/enqueueing it:

```ts
requireRoomAuthorization(job.roomId, 'tools');
workAuthorizations.capture(job.jobId, job.roomId, job.actor);
```

Capture again on an **explicit authorized resume**, before changing saved status to queued. Do not overwrite authorization for an already-running/idempotently returned job. On failed admission/card creation, forget the captured entry. Local captures are allowed with an undefined scope, preserving the loopback profile. On resume use the stored initiating `job.actor`, after validating it equals the signed caller.

## Replace the execution boundary in drain

Where the baseline has `Promise.resolve().then(() => this.execute(job, controller))`, wrap the entire execution:

```ts
const promise = Promise.resolve().then(() =>
  workAuthorizations.run(
    job.jobId, job.roomId, job.actor, controller,
    () => this.execute(job, controller),
  ),
).catch(error => {
  // Authorization can fail BEFORE execute(), including revocation while queued.
  // Persist an interrupted/cancelled terminal state with a bounded public reason.
  // Do not read or publish the room from this catch: it has no granted scope.
  if (activeStatus(job.status)) {
    job.status = 'interrupted';
    job.error = 'Room authorization ended. Resume explicitly with access.';
    this.save(job);
  }
}).finally(() => {
  workAuthorizations.forget(job.jobId);
  this.running.delete(job.jobId);
  this.trimCache();
  this.drain();
});
```

Keep existing running-map registration, concurrency, timeouts and cancellation behavior. `run` checks the **captured** actor/room against current role/revocation before executing, installs a revocation/expiry abort watcher, and runs under that job's own scope. The next drain iteration cannot inherit it as authorization for another job. If an executing callback spawns detached work, retain the same captured capability and lifetime; do not let it outlive this execution wrapper.

## Checkpoints, providers and commits

Call `requireRoomAuthorization(job.roomId, 'tools')` immediately before dispatching any provider/workspace command and after awaits before accepting generated output, saving a sensitive checkpoint, applying a diff or committing an artifact. Respect `controller.signal.aborted`. If the workspace runner uses its own shared transport callback/event queue, explicitly pass a captured per-job check/runner into those callbacks too; the transport's ambient context is insufficient.

Room commits through the application `RoomStore` already check the current scope. Keep the explicit checks at private project/workspace boundaries that bypass that store. Never authorize a job using a client project path, workspace ID or actor, and do not copy a fresh project snapshot over an existing continued workspace. GET job evidence must check the job's stored room, return only its bounded public evidence, and keep private project snapshots/paths out of the response.

The existing `execute()` error path publishes before saving. After revocation that publish throws. Persist the interrupted/cancelled status **first**, then attempt room publication only inside a still-authorized scope, catching authorization failure. Likewise, queued cancellation and shutdown must save terminal state even when the room can no longer be read. Unsubscribing/forgetting must happen for terminal jobs and service close (`workAuthorizations.close()`).

## Restore and shutdown

Restored jobs have no authorization capability. In invite mode, mark unfinished jobs interrupted and save without reading/publishing arbitrary rooms during the shared service constructor. Require explicit signed resume; no automatic provider replay. Preserve the existing local-profile recovery logic under `!inviteAuthorizationEnforced()`.

During shutdown, abort running controllers and persist bounded terminal status without needing a request's context. If authorized room reconciliation is desired, run it through the job's captured scope before forgetting it; skip room publication on revoked/expired scopes. Never turn off global enforcement to restore or publish jobs.

## Enable only after wiring

Once all the above is integrated in the coordinator's combined tree, import and call this once in server composition before accepting requests:

```ts
import { enableHostedWorkAuthorization } from './access/work-authorization';
enableHostedWorkAuthorization();
```

The flag only unlocks hosted route/tool entry points; it installs no queue adapter itself. Leaving it unset is safe and gives an explicit 503 for hosted work. Validate with two queued actors where the first job's `finally` starts the second: revoke the second before it executes, and verify no provider/workspace command or commit occurs. Repeat revocation while executing and before commit; check private snapshots survive while public status is bounded. The access suite independently covers the captured helper executing under the wrong ambient actor and rejecting a revoked queued capability.
