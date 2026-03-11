# PRESENT Reset Architecture

This branch introduces the reset-era platform skeleton without deleting the legacy app yet.

## New structure

- `packages/contracts`
  Shared Zod schemas for `workspace_session`, `executor_session`, `task_run`, `artifact`, `approval_request`, `presence_member`, `model_profile`, and runtime events.
- `services/kernel`
  Reset-era persisted services for workspaces, executors, leases, tasks, artifacts, approvals, traces, presence, model profiles, and runtime manifest generation.
- `services/codex-adapter`
  Codex app-server manifest + HTTP endpoint helpers plus SDK-backed turn execution and event/artifact mapping.
- `services/present-mcp`
  PRESENT-owned MCP server exposing workspace/task/turn/widget/artifact/approval/canvas tools and server-owned resources over stdio.
- `packages/ui`
  The new mission-control shell used by the root app surface.

## New app surface

- `/`
  No longer redirects into the legacy canvas. It renders the reset-era mission-control shell.
- `/api/reset/*`
  New kernel-backed HTTP endpoints for workspaces, executors, turns, tasks, artifacts, approvals, traces, presence, model profiles, and runtime manifest.

## Scripts

- `npm run present:mcp`
  Starts the stdio MCP server for local agents.
- `npm run codex:manifest`
  Prints the current Codex app-server manifest assumptions.

## Current boundaries

- The old canvas, voice, tool-dispatcher, fairy, widget-zoo, and showcase paths still exist in the repo.
- The root product surface now uses the reset-era kernel instead of redirecting into those older paths.
- The new shell is intentionally thin: it proves the contracts, routing, and external-agent seams before the deeper UI/client migrations land.
- The new shell is still intentionally smaller than the target product, but it now runs against a persisted reset kernel, workspace snapshot routes, and a real Codex turn/event seam.
