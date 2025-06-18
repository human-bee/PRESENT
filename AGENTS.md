# AGENTS.md

## Project Overview
This repo is a Next.js (TypeScript) app with Tambo AI for generative UI, LiveKit for real-time audio/video, and an OpenAI-powered voice agent. The agent logic runs as a separate Node.js process using the LiveKit Agents framework with automatic dispatch to all rooms.

## Agent Architecture
- **Primary Agent**: `src/lib/livekit-agent-worker.ts` - TypeScript agent using @livekit/agents framework
- **Voice Model**: OpenAI Realtime API (gpt-4o-realtime-preview)
- **Dispatch Mode**: Automatic dispatch (agent joins all rooms automatically)
- **Tools**: Extensible tool system in `src/lib/livekit-agent-tools.ts`
- **Alternative Agents**: Archived in `src/lib/archived-agents/` for reference

## Key Folders & Files
- `src/app/` — Next.js app routes and API endpoints
- `src/components/` — React UI components (Tambo, LiveKit, etc.)
- `src/lib/livekit-agent-worker.ts` — Main agent worker (runs as a separate process)
- `src/lib/livekit-agent-tools.ts` — Agent tool implementations
- `example.env.local` — Example environment variables (copy to `.env.local` and fill in keys)
- `package.json` — Scripts for build, test, lint, agent, etc.
- `TYPESCRIPT_AGENT_SETUP.md` — Detailed agent setup and architecture
- `README.md` — General project setup and usage

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
  - Terminal 1: `npm run agent:dev`   # Agent worker (start FIRST!)
  - Terminal 2: `npm run dev`         # Next.js app (localhost:3000)
- **Production:**
  - Terminal 1: `npm run agent:run`
  - Terminal 2: `npm run start`
- **Important:** Always start the agent before the web app for proper connection

## Test & Lint
- Run all tests: `npm test`
- Watch tests: `npm run test:watch`
- Lint code: `npm run lint`

## Validation Checklist
- [ ] Environment variables are set in `.env.local`
- [ ] Agent starts successfully (`registered worker` in logs)
- [ ] Web app connects to LiveKit room
- [ ] Agent joins room automatically (see `Job received!` in agent logs)
- [ ] Voice interactions work (speak and hear responses)
- [ ] All tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)

## Contribution & PR Guidelines
- Use clear, descriptive commit messages
- Leave your worktree clean (no uncommitted changes)
- Run all tests and lint before submitting a PR
- Follow existing code patterns and TypeScript conventions
- Test both voice and UI features before submitting

## More Documentation
- See `README.md` for general setup and usage
- See `TYPESCRIPT_AGENT_SETUP.md` for agent-specific implementation details
- See `LIVEKIT_TOOLBAR_TESTING.md` for UI component testing
- For Tambo AI, see [tambo.co/docs](https://tambo.co/docs)
- For LiveKit, see [docs.livekit.io](https://docs.livekit.io)

---
**For Codex:** Always run tests and lint after making changes. For agent-related work, ensure both the app and agent worker are running (agent first!) and connected. Check logs in both terminals for connection status. The agent uses automatic dispatch, so it will join all rooms created in your LiveKit project. 