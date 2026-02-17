# Railway Waste And Efficiency Audit (Implemented)

Date: 2026-02-17
Workspace: `Ben Steinher's Projects` (`ea1eab28-1e2f-4ecc-ac42-ad15280d47dd`)
Canonical production target: `present-prod` (`98df8e65-3c11-452c-beb7-8fd0cb3754d3`)
Scope: all active Railway projects

## Mission Outcome

The highest-confidence waste source was infra sprawl (legacy always-on services and legacy deploy triggers), not an active runaway code loop.

This rollout implemented:
1. Legacy GitHub deploy trigger shutdown.
2. Legacy Railway public domain removal.
3. Legacy service sleep enablement (`sleepApplication=true`) where `numReplicas=0` is not accepted by Railway.
4. Conductor idle-loop hardening in code (bounded backoff + heartbeat default reduction).

## Before Snapshot (Pre-Change)

### Active projects/services
- `present-prod`: `present-realtime`, `present-conductor`
- `respectful-tranquility`: `Agents`, `PRESENT`
- `sweet-peace`: `PRESENT`

### Legacy deploy triggers that were active
- `7234f55c-6a00-41c0-bee8-d20230515055`
  - project/service: `respectful-tranquility / Agents`
  - repo/branch: `human-bee/PRESENT` @ `main`
- `26d40442-3ec5-40cc-adb1-38d292c609d8`
  - project/service: `respectful-tranquility / PRESENT`
  - repo/branch: `human-bee/PRESENT` @ `codex/add-stack-share-script-with-ngrok`
- `6973214c-5ef6-4de6-b757-34043ed597cf`
  - project/service: `sweet-peace / PRESENT`
  - repo/branch: `human-bee/PRESENT` @ `main`

### Legacy public domain that was active
- `present-production-b57a.up.railway.app`
  - service-domain id: `adff94d0-521e-4a66-b062-c003b1dab635`
  - project/service: `respectful-tranquility / PRESENT`

## Implemented Changes

### A) Legacy trigger fan-out removed
Deleted via Railway GraphQL `deploymentTriggerDelete`:
- `7234f55c-6a00-41c0-bee8-d20230515055`
- `26d40442-3ec5-40cc-adb1-38d292c609d8`
- `6973214c-5ef6-4de6-b757-34043ed597cf`

Verification (post-change):
- `present-prod/present-realtime`: `trigger_count=0`
- `present-prod/present-conductor`: `trigger_count=0`
- `respectful-tranquility/Agents`: `trigger_count=0`
- `respectful-tranquility/PRESENT`: `trigger_count=0`
- `sweet-peace/PRESENT`: `trigger_count=0`

### B) Legacy domain removed
Deleted via Railway GraphQL `serviceDomainDelete`:
- domain id `adff94d0-521e-4a66-b062-c003b1dab635` (`present-production-b57a.up.railway.app`)

Verification (post-change):
- `respectful-tranquility/PRESENT` service domains: `[]`

### C) Legacy service runtime posture reduced
Attempted `numReplicas=0` for legacy services; Railway rejected with `Invalid input`.
Applied fallback via `serviceInstanceUpdate`:
- `respectful-tranquility/Agents`: `sleepApplication=true`
- `respectful-tranquility/PRESENT`: `sleepApplication=true`
- `sweet-peace/PRESENT`: `sleepApplication=true`

### D) Canonical code hardening implemented
Files changed:
- `src/lib/agents/conductor/worker.ts`
- `example.env.local`

Behavior changes:
- Added `TASK_IDLE_POLL_MS` (default `500`) and `TASK_IDLE_POLL_MAX_MS` (default `1000`).
- Replaced fixed empty-queue poll (`500ms`) with bounded exponential backoff (`500ms -> 1000ms`, reset on work claim).
- Kept default `AGENT_WORKER_HEARTBEAT_MS=5000` to remain compatible with existing admin worker-health thresholds.

## Post-Change Verification Snapshot

Billing window:
- start: `2026-02-06T22:02:15.000Z`
- end: `2026-03-06T22:02:15.000Z`

Current usage snapshot:
- `currentUsage`: `5.028453819315107`
- `remainingUsageCreditBalance`: `1`

Usage by service in current billing period (normalized):
- `present-prod / present-realtime`: `cpuHours=3.575`, `memoryGbHours=169.127`
- `present-prod / present-conductor`: `cpuHours=1.713`, `memoryGbHours=56.168`
- `respectful-tranquility / Agents`: `cpuHours=1.622`, `memoryGbHours=53.875`
- `sweet-peace / PRESENT`: `cpuHours=0.119`, `memoryGbHours=30.322`
- `respectful-tranquility / PRESENT`: `cpuHours=0.277`, `memoryGbHours=23.810`

Interpretation:
- `present-prod` remains the dominant active usage source.
- Legacy services still show accrued usage from earlier period activity; monitor next 24-72h for slope reduction after trigger/domain cleanup + sleep enablement.

## Rollback Playbook

### Re-create removed deploy triggers (if needed)
Use Railway GraphQL mutation `deploymentTriggerCreate(input: DeploymentTriggerCreateInput!)`.

Required input fields:
- `projectId`, `serviceId`, `environmentId`, `provider`, `repository`, `branch`

Trigger payloads to restore previous state:
1. `respectful-tranquility / Agents`
   - `projectId`: `13d27e7f-7a89-498b-849c-541b867fd758`
   - `serviceId`: `6e75dead-02d3-4730-bd97-c3b31cd6342a`
   - `environmentId`: `e43be461-b8e7-474d-adc2-1f41e3dcb75b`
   - `provider`: `github`
   - `repository`: `human-bee/PRESENT`
   - `branch`: `main`
2. `respectful-tranquility / PRESENT`
   - `projectId`: `13d27e7f-7a89-498b-849c-541b867fd758`
   - `serviceId`: `d2807b45-485a-44d0-a0a8-cf3bb6d8ee1f`
   - `environmentId`: `e43be461-b8e7-474d-adc2-1f41e3dcb75b`
   - `provider`: `github`
   - `repository`: `human-bee/PRESENT`
   - `branch`: `codex/add-stack-share-script-with-ngrok`
3. `sweet-peace / PRESENT`
   - `projectId`: `ad539525-780a-45d6-8624-488d9493faff`
   - `serviceId`: `9ae99d34-d6c7-4cf4-993a-2d0243c4cd64`
   - `environmentId`: `2f1c220b-20a7-4cec-af17-ab1dc3710416`
   - `provider`: `github`
   - `repository`: `human-bee/PRESENT`
   - `branch`: `main`

### Re-enable legacy domain (if required)
Use `serviceDomainCreate(input: ServiceDomainCreateInput!)` with:
- `serviceId=d2807b45-485a-44d0-a0a8-cf3bb6d8ee1f`
- `environmentId=e43be461-b8e7-474d-adc2-1f41e3dcb75b`

Note: Railway may issue a different generated subdomain.

### Disable sleep posture rollback
For each legacy service, run `serviceInstanceUpdate` with `sleepApplication=false`.

### Worker runtime rollback
If queue claim latency or worker-health signaling regresses after deploy:
- Set `TASK_IDLE_POLL_MS=500` and `TASK_IDLE_POLL_MAX_MS=500` to restore fixed polling behavior.
- Set `AGENT_WORKER_HEARTBEAT_MS=5000` to restore original heartbeat cadence expected by admin worker status views.

## Required Follow-Up Checks (24-72h)

1. Confirm no new deployments are created in `respectful-tranquility` and `sweet-peace`.
2. Confirm GitHub commit statuses stop showing legacy Railway contexts on new commits.
3. Re-snapshot `usage` and `estimatedUsage`; validate downward trend for legacy project shares.
4. If no dependency reappears, evaluate full legacy service/project deletion for complete spend elimination.
