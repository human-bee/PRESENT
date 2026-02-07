# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Project Setup

```bash
npm install                    # Install dependencies
cp example.env.local .env.local  # Copy and configure environment variables
npm run agent:build           # Build TypeScript agent worker
npm run build                 # Build Next.js application
```

### Development Workflow

```bash
# Terminal 1 (START FIRST - Agent must be running before web app)
npm run agent:dev             # Start voice agent worker in development mode

# Terminal 2 (START AFTER agent is running)
npm run dev                   # Start Next.js development server (localhost:3000)
```

### Production Deployment

```bash
npm run agent:build           # Build agent worker
npm run build                 # Build Next.js app
npm start                     # Start Next.js production server (Terminal 1)
npm run agent:run            # Start agent worker in production (Terminal 2)
```

### Testing and Quality

```bash
npm test                      # Run Jest tests
npm run test:watch           # Run tests in watch mode
npm run lint                 # ESLint code checking
npm run analyze              # Bundle analysis build
```

### Alternative Agent Modes

```bash
npm run agent:enhanced       # Enhanced agent with advanced features
npm run agent:multi          # Multi-session agent worker
npm run agent:whisper        # Whisper-specific agent worker
npm run agent:clean          # Clean/minimal agent implementation
```

## Project Architecture

### Agent System

This project uses a **realtime voice agent + conductor + stewards** architecture:

1. **🎙️ Voice Agent** (`src/lib/agents/realtime/voice-agent.ts`)
   - Node.js worker process using LiveKit Agents Realtime API
   - Captures voice input and provides real-time transcription
   - Enqueues work via `dispatch_to_conductor` or issues UI tool calls

2. **🧭 Conductor** (`src/lib/agents/conductor/`)
   - Queue-driven router that delegates to domain stewards
   - No business logic; routes tasks and aggregates context

3. **🧠 Stewards** (`src/lib/agents/subagents/`)
   - Domain owners (canvas, flowchart, infographic, etc.)
   - Read state from Supabase and emit structured UI patches

4. **🔧 Tool Dispatcher** (`src/components/tool-dispatcher.tsx`)
   - React component running in the browser
   - Executes `create_component` / `update_component` and TLDraw actions
   - Publishes results back via LiveKit data channels

### Key System Components

- **SystemRegistry** (`src/lib/system-registry.ts`): Single source of truth for all system capabilities, tool routing, and agent coordination
- **custom Integration** (`src/lib/custom.ts`): Registers UI components for AI-driven generative interfaces with intelligent parameter extraction
- **LiveKit Bridge** (`src/lib/livekit-agent-bridge.ts`): Handles real-time communication between agents
- **MCP Integration**: Model Context Protocol support for external tool providers
- **Canvas System**: Interactive tldraw-based collaboration space with voice integration

### Data Flow Pattern

1. User speaks → Voice Agent transcribes → dispatches task/tool
2. Conductor routes → Steward executes → Tool Dispatcher renders
3. Results publish back over LiveKit → Voice Agent responds

## Environment Configuration

Required API keys in `.env.local`:

- `NEXT_PUBLIC_custom_API_KEY`: custom AI generative UI service
- `LIVEKIT_API_KEY` & `LIVEKIT_API_SECRET`: LiveKit real-time communication
- `LIVEKIT_URL`: LiveKit server endpoint
- `OPENAI_API_KEY`: OpenAI Realtime API for voice processing
- `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase for auth/storage

## Important Development Notes

### Agent-First Development

- **Always start the agent worker first** (`npm run agent:dev`) before the web app
- The agent uses automatic dispatch mode - it joins all LiveKit rooms automatically
- Check agent logs for "registered worker" and "Job received!" messages to verify connection

### TypeScript Configuration

- Main app uses `tsconfig.json` with Next.js configuration
- Agent worker uses separate `tsconfig.agent.json` targeting Node.js environment
- Agent builds to `dist/agent/` directory with ES2020 modules

### Component Development

- Follow custom component patterns from `.cursor/rules/HOW_TO_CREATE_custom_COMPONENTS.mdc`
- Use `/ui` command with 21st-dev magic component builder for rapid prototyping
- Register components in `src/lib/custom.ts` with Zod schemas for AI understanding
- Components should be "canvas-first" with state persistence and real-time features

### Testing Workflow

- Run `npm test` after making changes to ensure tests pass
- Voice features require both agent and web app running simultaneously
- Check LiveKit room connections and data channel communication in browser console

### MCP Server Configuration

- Configure MCP servers via `/mcp-config` page in the running application
- MCP tools are automatically discovered and synced to SystemRegistry
- Support for both SSE and HTTP transport modes

## Key File Locations

- `src/app/`: Next.js pages and API routes
- `src/components/ui/`: custom-registered UI components
- `src/lib/`: Core system logic (agents, registries, integrations)
- `docs/`: Architecture documentation and system guides
- `.cursor/rules/`: Development guidelines and component creation patterns
