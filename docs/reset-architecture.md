# PRESENT Reset Architecture

This branch now runs the reset-era product surface at `/` while keeping the old app behind an archive boundary.

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
  The mission-control shell, reset-native collaboration surface, and collaborative Monaco editor used by the root app surface.

## New app surface

- `/`
  No longer redirects into the legacy canvas. It renders the reset-era mission-control shell.
- `/api/reset/*`
  Kernel-backed HTTP endpoints for workspaces, workspace files, collaborative editor state, executors, turns, tasks, artifacts, approvals, traces, presence, model profiles, and runtime manifest.
- `fairy:cli`
  Now includes reset-native commands for opening workspaces, browsing files, reading/writing documents, creating patch artifacts, applying artifacts, starting turns, and reading reset traces.

## Scripts

- `npm run present:mcp`
  Starts the stdio MCP server for local agents.
- `npm run codex:manifest`
  Prints the current Codex app-server manifest assumptions.
- `npm run typecheck`
  Now includes the reset compile surface in the default local typecheck gate.
- `npm run test:reset:e2e`
  Browser smoke for the reset shell and archive notice.

## Current boundaries

- The old canvas runtime still exists, but `/canvas`, `/canvases`, `/mcp-config`, and `/showcase/ui` now default to archive or bridge behavior instead of serving as primary product entries.
- The root product surface now uses the reset-era kernel instead of redirecting into those older paths.
- The reset shell now operates on real workspace files, stages and applies patch artifacts, mounts a reset-native TLDraw collaboration surface directly in `/`, and keeps the archived canvas reachable only as an explicit archive route.
- The editor surface is now a collaborative Monaco + Yjs session backed by `/api/reset/workspaces/[workspaceSessionId]/collaboration`, rather than a textarea with tab-local draft sync.
- The BYO-agent surface is now verified through the stdio MCP server itself, including `present://runtime/interop` and patch application over a real MCP client transport.
- The reset kernel still uses a local JSON hot cache for synchronous service calls, but when Supabase is configured it now rehydrates on a short TTL and flushes route mutations before responding so the database can act as the durable backing store without reintroducing legacy room semantics.
- The reset shell, reset APIs, stdio MCP server, CLI interop, browser smoke, reset test suite, and repo-wide typecheck now all pass together on this branch.
