import asyncio
import logging
import os
from dotenv import load_dotenv
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli
from livekit.agents.voice_assistant import VoiceAssistant
from livekit.plugins import openai, silero

# Load environment variables
load_dotenv()

logger = logging.getLogger("voice-agent")

async def entrypoint(ctx: JobContext):
    """Entry point for the agent when it joins a room"""
    initial_ctx = "You are a helpful voice assistant."
    logger.info(f"🤖 Agent joining room: {ctx.room.name}")
    
    # Simple agent that just connects and logs
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("✅ Agent successfully connected to room")
    
    # Keep the agent alive
    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    # Check if Python agent should be disabled
    if os.getenv('DISABLE_PYTHON_AGENT', 'false').lower() == 'true':
        print("🚫 Python agent disabled via DISABLE_PYTHON_AGENT environment variable")
        print("   Using TypeScript agent bridge instead")
        exit(0)
    
    print("🤖 Starting Python LiveKit agent...")
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
