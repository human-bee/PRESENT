# `AGENTS.md`

## Project Structure & Module Organization

- `src/app/`: Next.js routes (App Router) and API endpoints.
- `src/components/`: React UI (feature-based folders; see `docs/code-organization.md`).
  - `src/components/ui/canvas/hooks/`: TLDraw canvas hooks (component store, rehydration, LiveKit event wiring).
- `src/lib/`: Agent workers, tools, and utilities.
  - `src/lib/agents/realtime/voice-agent.ts`: Primary LiveKit agent (Realtime API).
  - `src/lib/agents/conductor/`: Router agent with handoffs.
  - `src/lib/agents/subagents/`: Domain-specific stewards (flowchart, youtube, …).
  - `src/lib/agents/shared/`: Shared contracts and Supabase helpers.
  - `src/lib/archived-agents/`: Legacy agents for reference.
- `public/`: Static assets. `docs/`: additional project docs.
- Tests are colocated as `*.test.ts(x)` or under `__tests__/`; mocks live in `__mocks__/`.
- Env: copy `example.env.local` → `.env.local` and fill required keys.

## Build, Test, and Development Commands

- `npm install`: Install dependencies.
- `npm run agent:build`: Build the (legacy) TypeScript agent worker.
- `npm run build`: Build the Next.js app.
- `npm run agent:realtime`: Run the LiveKit Realtime voice agent (start this first).
- `npm run agent:conductor`: Run the Agents SDK conductor/stewards process.
- `npm run dev`: Run the web app at `http://localhost:3000`.
- Prod: `npm run agent:run` (legacy pipeline) and `npm run start`.
- Tests: `npm test` (Jest) or `npm run test:watch`.
- Lint: `npm run lint` (ESLint/Next rules).

## Coding Style & Naming Conventions

- TypeScript across app and agent. Prefer explicit types on public APIs.
- 2-space indentation; single quotes; consistent semicolons.
- Components: PascalCase (`UserMenu.tsx`); hooks/utils: camelCase; non-component files/folders: kebab-case.
- Keep modules small; colocate component styles and tests with the implementation.
- All files aim for ≤200 LoC. Extract helpers early.Keep Repo Clean and Nested

## Testing Guidelines

- Framework: Jest with `jsdom` and Testing Library for React.
- Location: `*.test.ts(x)` next to code or in `__tests__/`.
- Mocks: use `__mocks__/` and `jest.mock` where appropriate.
- Run `npm test` before PRs; cover critical paths (agent tools, LiveKit flows, UI actions).
- Test agent contracts with mock LiveKit data channel messages.

## Commit & Pull Request Guidelines

- Commits: Clear, imperative messages (e.g., "fix: handle LiveKit reconnect").
- PRs: Include summary, linked issues, UI screenshots (when applicable), and notes for agent changes (logs or sample transcript).
- Requirements: Passing tests and lint (`npm test`, `npm run lint`); no uncommitted changes.

## Agent-Specific Instructions & Security

- Always start the agent before the web app. Look for "registered worker" and then "Job received!" in agent logs.
- Secrets live in `.env.local` (never commit). Required keys include LiveKit, OpenAI, custom, and Supabase.
- Dispatch is automatic: the agent joins all rooms in your LiveKit project.

# Agents: Runtime, Roles & Contracts

If it doesn't move the canvas, it doesn't belong in the voice agent. This document defines the small set of agents we actually run, the messages they speak, and the contracts the browser must honor—no more heuristic soup.

## Startup scripts (new architecture)

- `npm run agent:realtime`: Starts the LiveKit Realtime voice agent (`src/lib/agents/realtime/voice-agent.ts`). It listens to the room, transcribes, and emits only two UI tools: `create_component` and `update_component`.
- `npm run agent:conductor`: Starts the Conductor (Agents SDK). It routes `dispatch_to_conductor` requests to stewards (e.g., Flowchart Steward) using handoffs.
- Both must be running for the steward-managed flowchart pipeline.

## Topology (one screen's worth)

- **Voice Agent (Realtime, Node)**
  Listens to the room, transcribes, and calls exactly two UI tools via LiveKit data channel. May hand off server-side work to the Conductor.
- **Conductor (Agents SDK, Node)**
  A tiny router that delegates to **steward** subagents via handoffs. No business logic.
- **Stewards (Agents SDK, Node)**
  Domain owners (e.g., **Flowchart Steward**, **YouTube Steward**). They read context (Supabase), produce a complete artifact, and emit one UI patch or component creation.
- **Browser ToolDispatcher (React, client)**
  A bridge, not an agent. Executes `create_component` and `update_component`. Sends `tool_result`/`tool_error`. Dispatches TLDraw DOM events when needed.
- **Supabase**
  Source of truth for transcripts and flowchart docs (format + version).

Check /docs for more tips
