# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Project Setup

```bash
npm install                    # Install dependencies
cp example.env.local .env.local  # Copy and configure environment variables
npm run build                 # Build Next.js application
```

### Development Workflow (Recommended)

**Start all services at once:**
```bash
npm run stack:start           # Start entire stack (LiveKit, sync server, agents, Next.js)
npm run stack:stop            # Stop all background services
npm run stack:restart         # Restart entire stack
npm run stack:share           # Start stack with ngrok tunnels for remote collaboration
```

**Or start services individually:**
```bash
# Terminal 1 - Voice Agent (Realtime - START FIRST)
npm run agent:realtime        # OpenAI Realtime API voice agent

# Terminal 2 - Conductor Agent (Agents SDK)
npm run agent:conductor       # Conductor + stewards for complex tasks

# Terminal 3 - Next.js App
npm run dev                   # Next.js development server (localhost:3000)

# Optional Terminal 4 - TLDraw Sync Server
npm run sync:dev              # Local TLDraw sync server (cross-session canvas sync)

# Optional Terminal 5 - LiveKit Server
npm run lk:server:dev         # Local LiveKit server (dev mode)
```

### Production Deployment

```bash
npm run build                 # Build Next.js app
npm start                     # Start Next.js production server

# In separate terminals:
npm run agent:realtime        # Voice agent (production)
npm run agent:conductor       # Conductor agent (production)
```

### Testing and Quality

```bash
npm test                      # Run Jest tests
npm run test:watch           # Run tests in watch mode
npm run lint                 # ESLint code checking
npm run analyze              # Bundle analysis build
npm run biome:check          # Biome linting check
npm run format               # Format code with Biome
```

### Alternative/Legacy Agent Modes

```bash
npm run agent:dev             # Legacy voice agent worker
npm run agent:enhanced       # Enhanced agent with advanced features
npm run agent:multi          # Multi-session agent worker
npm run agent:whisper        # Whisper-specific agent worker
npm run agent:clean          # Clean/minimal agent implementation
npm run agent:fixed          # Fixed agent implementation
```

### Utility Scripts

```bash
npm run icons:ios             # Generate iOS icons
npm run teacher:worker        # Run teacher worker agent
```

## Project Architecture

### Modern Two-Agent System + Browser Dispatcher

This project implements a streamlined **2-agent architecture** with browser-based tool execution:

1. **🎙️ Voice Agent (Realtime)** (`src/lib/agents/realtime/voice-agent.ts`)
   - Node.js worker using LiveKit Agents + OpenAI Realtime API
   - Handles real-time voice transcription and conversation flow
   - Calls two primary UI tools: `create_component` and `update_component`
   - Can delegate complex tasks to Conductor via `dispatch_to_conductor`
   - Supports two transcription modes:
     - **Realtime mode** (default): Native speech recognition from Realtime API
     - **Manual mode**: Client data channel transcripts (set `VOICE_AGENT_TRANSCRIPTION_MODE=manual`)

2. **🧠 Conductor + Stewards** (`src/lib/agents/conductor/` + `src/lib/agents/subagents/`)
   - **Conductor**: Lightweight router (Agents SDK) that delegates to domain-specific stewards via handoffs
   - **Stewards**: Specialized agents for specific domains:
     - **Canvas Steward** (`canvas-steward.ts`): TLDraw canvas manipulation and visual reasoning
     - **Flowchart Steward** (`flowchart-steward.ts`): Diagram creation and updates
     - **YouTube Steward** (`youtube-steward.ts`): Video content integration
     - **Search Steward** (`search-steward.ts`): Web search and information retrieval
   - Stewards read state from Supabase, reason holistically, and emit structured UI updates
   - Commits trigger `/api/steward/commit`, broadcasting updates over LiveKit data channels

3. **🔧 Browser Tool Dispatcher** (`src/components/tool-dispatcher.tsx`)
   - React component executing UI tools in the browser
   - Routes tool calls to appropriate handlers (custom UI, MCP tools, built-in functions)
   - Updates TLDraw canvas or React components based on tool calls
   - Returns `tool_result` or `tool_error` events to agents via LiveKit
   - Manages execution state with circuit breaker patterns

### Key System Components

- **Canvas Agent Service** (`src/lib/agents/canvas-agent/`): Unified server-centric canvas agent with screenshot capabilities, action streaming, and prompt caching
- **System Registry** (`src/lib/system-registry.ts`): Single source of truth for system capabilities and tool routing
- **custom Integration** (`src/lib/custom.ts`): Registers UI components for AI-driven generative interfaces with Zod schemas
- **LiveKit Bridge** (`src/lib/livekit-agent-bridge.ts`): Real-time communication layer between agents and browser
- **MCP Integration**: Model Context Protocol support for external tool providers
- **Canvas System** (`src/components/ui/canvas/`): Interactive TLDraw-based collaboration space with voice integration
- **Task Queue** (`src/lib/agents/shared/queue.ts`): Manages concurrent steward execution with configurable concurrency limits

### Data Flow Pattern

**Voice Interaction:**
1. User speaks → Voice Agent (Realtime) transcribes → Analyzes intent
2. Simple UI update → Calls `create_component` or `update_component` → Browser Tool Dispatcher executes
3. Complex task → Calls `dispatch_to_conductor` → Conductor routes to appropriate Steward

**Steward Execution:**
1. Conductor receives handoff → Routes to domain Steward (Canvas, Flowchart, etc.)
2. Steward reads state from Supabase → Reasons about changes → Generates structured actions
3. Steward commits to `/api/steward/commit` → Broadcasts via LiveKit → Browser Tool Dispatcher applies updates

### Legacy Architecture

The original three-agent system (`livekit-agent-worker.ts` + `decision-engine.ts`) is now archived. See `docs/THREE_AGENT_ARCHITECTURE.md` for historical reference.

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
