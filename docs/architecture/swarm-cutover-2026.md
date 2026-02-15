# Swarm Cutover 2026

## Objective

Move orchestration decisions to swarm runtime while preserving queue transport and realtime voice ingress.

## Current Implementation

- `executeTask` in conductor router delegates to swarm orchestrator when `SWARM_ORCHESTRATION_ENABLED=true`.
- Swarm policy performs fairy-first routing and optional speculative search hint fallback.
- Legacy task execution remains available as fallback path.

## Why Queue + Voice Stay

- Queue remains the ordering/retry/backpressure source of truth.
- Voice ingress remains the low-latency speech and transcript path.

## Observability

- Queue, worker, API, and ack stages emit `agent_trace_events`.
- Worker liveness is stored in `agent_worker_heartbeats`.
- Admin remediation is audited in `agent_ops_audit_log`.

## Rollout

1. Enable swarm in non-prod.
2. Validate p95 latency and error-rate gates.
3. Enable by task family.
4. Promote to default when gates pass.
