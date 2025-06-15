# AGENTS.md

## Project Overview
This repo is a Next.js (TypeScript) app with Tambo AI for generative UI, LiveKit for real-time audio/video, and an OpenAI-powered agent. The agent logic runs as a separate Node.js process. The project supports both web UI and voice/agent-driven workflows.

## Key Folders & Files
- `src/app/` — Next.js app routes and API endpoints
- `src/components/` — React UI components (Tambo, LiveKit, etc.)
- `src/lib/livekit-agent-worker.ts` — Main agent worker (runs as a separate process)
- `example.env.local` — Example environment variables (copy to `.env.local` and fill in keys)
- `package.json` — Scripts for build, test, lint, agent, etc.
- `TYPESCRIPT_AGENT_SETUP.md` — Detailed agent setup and architecture
- `README.md` — General project setup and usage
- `.taskmaster/` — Task Master AI-driven workflow (optional, see dev_workflow rule)

## Environment Setup
- Copy `example.env.local` to `.env.local` if not present
- Fill in all required API keys (Tambo, LiveKit, OpenAI, Supabase, etc.) in `.env.local`
- The app will not function without valid API keys

## Install & Build
```bash
npm install
npm run agent:build   # Build agent worker (TypeScript)
npm run build         # Build Next.js app
```

## Running the Project
- **Full dev mode (recommended):**
  - Terminal 1: `npm run dev`         # Next.js app (localhost:3000)
  - Terminal 2: `npm run agent:dev`   # Agent worker (hot reload)
- **Production:**
  - Terminal 1: `npm run start`
  - Terminal 2: `npm run agent:run`
- **Simplest mode:**
  - `npm run dev` (runs only the Next.js app, no agent worker)

## Test & Lint
- Run all tests: `npm test`
- Watch tests: `npm run test:watch`
- Lint code: `npm run lint`

## Validation Checklist
- All tests must pass (`npm test`)
- Lint must pass (`npm run lint`)
- Both the app and agent worker must start and connect (see logs in both terminals)
- For UI/voice features, verify agent logs and UI status (see TYPESCRIPT_AGENT_SETUP.md)

## Contribution & PR Guidelines
- Use clear, descriptive commit messages
- Leave your worktree clean (no uncommitted changes)
- Run all tests and lint before submitting a PR
- Follow code style and patterns in the codebase
- See AGENTS.md and project docs for any special instructions

## Task Management (Optional)
- This repo supports Task Master for AI-driven, task-based workflows (see `.taskmaster/` and dev_workflow rule)
- Use Task Master CLI or MCP server for advanced task tracking and breakdown

## More Documentation
- See `README.md` for general setup and usage
- See `TYPESCRIPT_AGENT_SETUP.md` for agent-specific details
- See `LIVEKIT_TOOLBAR_TESTING.md` and `TRANSCRIPTION_SERVICE_SETUP.md` for integration/testing
- For Tambo AI, see [tambo.co/docs](https://tambo.co/docs)

---
**For Codex:** Always run tests and lint after making changes. For agent-related work, ensure both the app and agent worker are running and connected. If in doubt, check the logs in both terminals and review the docs above. 