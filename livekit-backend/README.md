# Tambo LiveKit Agent Backend

A simplified conversational AI agent that integrates with Tambo UI components via LiveKit.

## Architecture

The agent is now organized into modular components:

### Core Files

- **`agent_simple.py`** - Main simplified agent (NEW)
- **`config.py`** - Configuration management (NEW)
- **`tools.py`** - Function tool definitions (NEW)
- **`transcription.py`** - Real-time transcription handling (NEW)
- **`agent_original.py`** - Original complex agent (BACKUP)

### Key Features

- 🎤 **Real-time transcription** - Live speech-to-text with broadcasting
- 🔧 **Tool calling system** - Dispatches tasks to frontend components
- 🎨 **Tambo UI integration** - Components appear on canvas automatically
- ⚙️ **Configurable** - Environment-based configuration
- 📝 **Clean architecture** - Separated concerns, easier to extend

## How It Works

1. **Voice Input** → Agent listens to conversations via LiveKit
2. **Transcription** → Real-time speech-to-text with participant broadcasting  
3. **LLM Processing** → Agent analyzes conversation and determines actions
4. **Tool Calling** → Agent calls appropriate tools (YouTube search, etc.)
5. **RPC to Frontend** → Tasks sent to frontend via `youtubeSearch` RPC method
6. **Component Display** → Frontend creates components that appear on Tambo canvas

## Configuration

Set environment variables in `.env`:

```bash
# Model Configuration
AGENT_LLM_MODEL=gpt-4.1-nano
AGENT_STT_MODEL=whisper-large-v3-turbo
AGENT_TTS_MODEL=tts-1
AGENT_STT_LANGUAGE=en

# Agent Configuration  
AGENT_NAME="Tambo AI"
AGENT_MAX_TOOL_STEPS=1
AGENT_ENABLE_TRANSCRIPTION=true
AGENT_ENABLE_VOICE_RESPONSE=true
AGENT_SHUTDOWN_TIMEOUT=300

# Custom Instructions (optional)
AGENT_SYSTEM_INSTRUCTIONS="Your custom system prompt..."
```

## Running the Agent

```bash
# Install dependencies
pip install -r requirements.txt

# Run the simplified agent
python agent_simple.py

# Or run the original (complex) agent
python agent.py
```

## Adding New Tools

1. Create a new function tool in `tools.py`:

```python
@function_tool()
async def my_new_tool(context: RunContext, param: str) -> Dict[str, Any]:
    """Tool description for the LLM"""
    # Your tool logic here
    return await send_task_to_frontend("MyTask", param, "myRpcMethod")
```

2. Add it to the `AVAILABLE_TOOLS` list
3. Handle the RPC method in the frontend

## Frontend Integration

The agent communicates with the frontend via RPC:

- **`youtubeSearch`** - YouTube-related tasks
- **`executeFrontendAITask`** - General AI tasks
- Components automatically dispatch `tambo:showComponent` events to appear on canvas

## Key Simplifications

✅ **Removed**: 200+ lines of hardcoded chat context  
✅ **Removed**: Verbose system instructions (50+ lines → 10 lines)  
✅ **Removed**: Complex event handlers  
✅ **Added**: Modular architecture with clear separation  
✅ **Added**: Environment-based configuration  
✅ **Added**: Better error handling and logging  
✅ **Kept**: All tool calling functionality intact  
✅ **Kept**: Real-time transcription  
✅ **Kept**: Frontend RPC integration 