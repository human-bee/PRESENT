# TypeScript Agent Setup

This document explains the new TypeScript LiveKit agent implementation that replaces the Python backend.

## Architecture Overview

The TypeScript agent is now properly separated:
1. **Agent Worker** (`src/lib/livekit-agent-worker.ts`) - Runs as a separate Node.js process
2. **API Route** (`/api/agent/dispatch`) - Only creates tokens, doesn't import agent code
3. **Frontend** - Receives transcriptions and component data via LiveKit data channels

## What We've Built

### 1. Standalone Agent Worker (`src/lib/livekit-agent-worker.ts`)
- Runs as a separate Node.js process (not imported by Next.js)
- Uses official `@livekit/agents` framework
- Integrates with OpenAI Realtime API via `@livekit/agents-plugin-openai`
- Defines tool functions for surfacing Tambo UI components:
  - `surface_timer` - Creates RetroTimer components
  - `surface_button` - Creates Button components
- Sends transcriptions and component data via LiveKit data channels

### 2. Simplified API Route (`/api/agent/dispatch`)
- **No longer imports agent code** (fixes the native module errors)
- Only generates LiveKit tokens for agents
- Returns token info for debugging

### 3. Type Definitions (`src/lib/livekit-agent-bridge.ts`)
- Contains only TypeScript interfaces and types
- No implementation code that could cause import issues

### 4. Updated Speech Transcription Component
- Listens for transcription data from the LiveKit agent
- Shows real-time agent status and connection state
- No browser speech recognition dependency

## Running the TypeScript Agent

### Prerequisites
Ensure your `.env.local` file has all required variables:
```bash
OPENAI_API_KEY=your_openai_api_key
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_secret
LIVEKIT_URL=wss://your-livekit-server.com
DISABLE_PYTHON_AGENT=true  # Add this to disable Python agent
```

### Option 1: Development Mode (Recommended)
Run in two separate terminals:

**Terminal 1 - Next.js Dev Server:**
```bash
npm run dev
```

**Terminal 2 - Agent Worker:**
```bash
npm run agent:dev
```

This uses `tsx` to run the TypeScript agent directly with hot reloading.

### Option 2: Production Mode
**Step 1 - Build the agent:**
```bash
npm run agent:build
```

**Step 2 - Run in separate terminals:**

Terminal 1:
```bash
npm run dev  # or npm start for production
```

Terminal 2:
```bash
npm run agent:run
```

## Testing the Setup

1. **Start both processes** (Next.js and Agent Worker)
2. **Navigate to your canvas page**
3. **Look for agent logs** in Terminal 2:
   ```
   🚀 Starting Tambo Voice Agent Worker...
   🤖 Tambo Voice Agent connected to room
   ✅ Tambo Voice Agent started successfully
   ```
4. **Check the Speech Transcription component**:
   - Should show "Agent Ready" (not "Waiting for Agent")
   - Click "Start Listening"
5. **Test voice commands**:
   - "show timer" → Should surface RetroTimer component
   - "create button" → Should surface Button component

## Architecture Flow

```
User Speech → LiveKit Room → Agent Worker (separate process)
                                    ↓
                            OpenAI Realtime API
                                    ↓
                            Tool Function Calls
                                    ↓
Transcription ← LiveKit Data Channel ← Agent publishes data
     ↓
Frontend UI Updates
```

## Debugging

### Check Processes
1. **Next.js server** should be running without import errors
2. **Agent worker** should show connection logs in its terminal

### Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "Module parse failed" errors | Agent code is being imported in browser. Check that API route doesn't import agent. |
| Agent not connecting | Check LIVEKIT credentials in `.env.local` |
| No transcriptions | Verify OPENAI_API_KEY and check agent worker logs |
| "Waiting for Agent" stuck | Make sure agent worker is running in separate terminal |

### Viewing Logs
- **Next.js logs**: Terminal 1 (API routes, frontend)
- **Agent logs**: Terminal 2 (connection, transcriptions, tool calls)

## Next Steps
1. Implement actual OpenAI Realtime API audio processing
2. Add more tool functions for additional UI components
3. Implement proper STT/TTS pipeline
4. Add reconnection logic and error recovery
5. Deploy agent as a separate service/container

## Reverting to Python Agent
To go back to the Python agent:
1. Remove `DISABLE_PYTHON_AGENT=true` from `.env.local`
2. Stop the TypeScript agent worker
3. Restart the dev server 