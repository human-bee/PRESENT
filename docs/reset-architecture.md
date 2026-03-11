# PRESENT Reset Architecture

This branch introduces the reset-era platform skeleton without deleting the legacy app yet.

## New structure

- `packages/contracts`
  Shared Zod schemas for `workspace_session`, `executor_session`, `task_run`, `artifact`, `approval_request`, `presence_member`, `model_profile`, and runtime events.
- `services/kernel`
  Reset-era persisted services for workspaces, executors, leases, tasks, artifacts, approvals, traces, presence, model profiles, runtime manifest generation, and real workspace file operations.
- `services/codex-adapter`
  Codex app-server manifest + HTTP endpoint helpers plus SDK-backed turn execution and event/artifact mapping.
- `services/present-mcp`
  PRESENT-owned MCP server exposing workspace/files/task/turn/widget/artifact/approval/canvas tools and server-owned resources over stdio.
- `packages/ui`
  The new mission-control shell used by the root app surface.

## New app surface

- `/`
  No longer redirects into the legacy canvas. It renders the reset-era mission-control shell.
- `/api/reset/*`
  New kernel-backed HTTP endpoints for workspaces, workspace files, executors, turns, tasks, artifacts, approvals, traces, presence, model profiles, and runtime manifest.
- `fairy:cli`
  Now includes reset-native commands for opening workspaces, browsing files, reading/writing documents, creating patch artifacts, applying artifacts, starting turns, and reading reset traces.

## Scripts

- `npm run present:mcp`
  Starts the stdio MCP server for local agents.
- `npm run codex:manifest`
  Prints the current Codex app-server manifest assumptions.
- `npm run typecheck`
  Now includes the reset compile surface in the default local typecheck gate.

## Current boundaries

- The old canvas runtime still exists, but `/canvas`, `/canvases`, `/mcp-config`, and `/showcase/ui` now default to archive or bridge behavior instead of serving as primary product entries.
- The root product surface now uses the reset-era kernel instead of redirecting into those older paths.
- The reset shell now operates on real workspace files, can generate/apply patch artifacts, and embeds the archived legacy canvas through an iframe bridge so `/` remains the main entry point.
- The new shell is still smaller than the target product, but it now runs against a persisted reset kernel, workspace snapshot routes, a real Codex turn/event seam, and a reset-native BYO-agent CLI/MCP surface.
