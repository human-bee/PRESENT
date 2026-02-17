# Admin Observability Expansion Proof (2026-02-17)

## Scope Delivered

- Signed-in-only detail guards for admin observability detail routes.
- Enriched queue + trace diagnostics (failure reason, failure stage/subsystem, worker attribution).
- New trace context endpoint with transcript pagination.
- Admin UI diagnostics upgrade:
  - queue-vs-worker semantics
  - failure summary banner
  - per-event payload inspector
  - raw/pretty JSON toggle
  - mask-sensitive toggle with explicit unmask confirmation
  - lazy/collapsible transcript history panel
  - reduced polling and hidden-tab pause behavior

## Verification Commands

### Type safety

```bash
npm run typecheck
```

Result: pass (`typecheck:app` and `typecheck:agent`).

### Targeted tests

```bash
npm test -- --runTestsByPath \
  src/lib/agents/admin/auth.test.ts \
  src/app/api/admin/agents/traces/route.test.ts \
  src/app/api/admin/agents/queue/route.test.ts \
  src/app/api/admin/agents/traces/[traceId]/context/route.test.ts \
  src/app/api/traces/[traceId]/route.test.ts \
  src/lib/agents/admin/trace-diagnostics.test.ts \
  src/lib/agents/admin/json-display.test.ts \
  src/components/admin/agent-ops-overview.test.tsx \
  src/components/admin/agent-queue-table.test.tsx \
  src/app/admin/agents/page.test.tsx
```

Result: `10 passed, 10 total` test suites (`30 passed` tests).

### Lint note

```bash
npm run lint
```

Result: repository has pre-existing Biome warnings outside this change set; no new lint blockers were introduced by this work.

## Behavioral Proof Points

1. Detail auth split:
   - `overview` can remain summary-readable in open/public mode.
   - detail endpoints now require a signed-in user by default (`AGENT_ADMIN_DETAIL_SIGNED_IN_REQUIRED=true`).
2. Failure causality:
   - failed traces expose `failure_reason`, `stage`, and derived `subsystem`.
3. Worker attribution:
   - worker metadata is emitted in executing/completed/failed trace payloads and surfaced in queue/trace APIs.
4. Thread history:
   - `/api/admin/agents/traces/:traceId/context` resolves task + session context and paginates transcript lines (`direction`, `beforeTs`, `afterTs`).
5. UI semantics and controls:
   - “Running Tasks” and “Active Workers” are separated.
   - payload display supports pretty/raw + masking control and clipboard export.

## Screenshot Artifact

- `/Users/bsteinher/.codex/worktrees/96f3/PRESENT/docs/qa/admin-observability/screenshots/2026-02-17-admin-observability-expanded.png`

Captured via:

```bash
npx playwright screenshot --device='Desktop Chrome' http://127.0.0.1:3000/admin/agents docs/qa/admin-observability/screenshots/2026-02-17-admin-observability-expanded.png
```
