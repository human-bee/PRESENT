"""
Simplified LiveKit Conversational Agent for Tambo UI Integration

This agent listens to voice conversations, transcribes them in real-time,
and calls tools to dispatch tasks to the frontend Tambo components.
"""

import asyncio
import logging
from typing import AsyncIterable, Optional, List
from dotenv import load_dotenv

from livekit import agents
from livekit.agents import (
    Agent, AgentSession, RoomInputOptions, RoomOutputOptions, 
    JobContext, RunContext, ChatContext, ChatMessage, 
    ModelSettings, stt, llm, FunctionTool
)
from livekit.plugins import openai, groq, noise_cancellation, silero
from livekit import rtc

# Import our simplified modules
from config import load_config, get_chat_context
from tools import AVAILABLE_TOOLS
from transcription import TranscriptionHandler

load_dotenv(override=True)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("livekit.assistant")

class TamboConversationalAgent(Agent):
    """Simplified conversational agent for Tambo UI integration"""
    
    def __init__(self, config: dict):
        self.config = config
        self.transcription_handler = TranscriptionHandler(
            enable_transcription=config["agent"].enable_transcription
        )
        
        # Initialize with dynamic chat context
        chat_context = llm.ChatContext([
            llm.ChatMessage(role="system", content=config["system"].base_instructions)
        ])
        
        # Add any initial context messages
        for ctx_msg in get_chat_context():
            chat_context.messages.append(
                llm.ChatMessage(role=ctx_msg["role"], content=ctx_msg["content"])
            )
        
        super().__init__(
            instructions=config["system"].base_instructions,
            chat_ctx=chat_context
        )
        
        logger.info(f"Initialized {config['agent'].agent_name} with {len(AVAILABLE_TOOLS)} tools")

    async def stt_node(
        self, audio: AsyncIterable[rtc.AudioFrame], model_settings: ModelSettings
    ) -> Optional[AsyncIterable[stt.SpeechEvent]]:
        """Handle speech-to-text with optional transcription broadcasting"""
        return self.transcription_handler.process_stt_stream(audio, model_settings, self)

    async def llm_node(
        self, chat_ctx: ChatContext, tools: List[FunctionTool], model_settings: ModelSettings
    ):
        """Handle LLM processing with tool calling"""
        logger.info("LLM processing user turn...")
        
        tool_choice = "required"  # Always require a tool call
        async with self.session.llm.chat(
            chat_ctx=chat_ctx,
            tools=tools, 
            tool_choice=tool_choice,
        ) as stream:
            async for chunk in stream:
                yield chunk

    async def on_user_turn_completed(
        self, turn_ctx: ChatContext, new_message: ChatMessage,
    ) -> None:
        """Callback triggered after each complete user turn"""
        logger.info(f"User turn completed: \"{new_message.content[:100]}...\"")
        # The AgentSession will handle LLM processing and tool calling automatically

    @property
    def default_stt_node(self):
        """Get the default STT node from the parent Agent class"""
        return super().stt_node

async def entrypoint(ctx: JobContext):
    """Main entry point for the agent"""
    logger.info("=== TAMBO AGENT STARTING ===")
    logger.info(f"Room: {ctx.room.name}, Participant: {ctx.participant}")
    
    # Load configuration
    config = load_config()
    
    await ctx.connect()
    logger.info(f"🎯 Agent connected to room: '{ctx.room.name}'")
    
    # Create agent session with configured models
    session = AgentSession(
        llm=openai.LLM(model=config["models"].llm_model),
        stt=groq.STT(
            model=config["models"].stt_model,
            language=config["models"].stt_language,
        ),
        tts=openai.TTS(model=config["models"].tts_model) if config["agent"].enable_voice_response else None,
        vad=silero.VAD.load(),
        max_tool_steps=config["agent"].max_tool_steps,
    )
    
    # Set up event handlers
    setup_room_events(ctx.room)
    
    # Create and start the agent
    agent = TamboConversationalAgent(config)
    logger.info("Starting agent session...")
    
    try:
        await session.start(
            room=ctx.room,
            agent=agent,
            room_input_options=RoomInputOptions(
                text_enabled=True,
                audio_enabled=True,
                noise_cancellation=noise_cancellation.BVC(),
            ),
            room_output_options=RoomOutputOptions(
                transcription_enabled=config["agent"].enable_transcription,
                audio_enabled=config["agent"].enable_voice_response
            )
        )
        logger.info("✅ Agent session started successfully")
        
        # Optional welcome
        await session.say("")
        
    except Exception as e:
        logger.error(f"💥 Failed to start agent session: {e}", exc_info=True)
        raise

def setup_room_events(room):
    """Set up room event handlers"""
    
    @room.on("participant_connected")
    def on_participant_connected(participant):
        is_real_user = not any(keyword in participant.identity.lower() 
                             for keyword in ['agent', 'bot', 'ai'])
        
        if is_real_user:
            logger.info(f"🎉 Real user joined: {participant.identity}")
        else:
            logger.info(f"🤖 Agent/bot joined: {participant.identity}")

    @room.on("participant_disconnected") 
    def on_participant_disconnected(participant):
        logger.info(f"👋 Participant left: {participant.identity}")

    @room.on("disconnected")
    def on_disconnected():
        logger.warning("🔌 Agent disconnected from room!")

    @room.on("reconnected")
    def on_reconnected():
        logger.info("✅ Agent reconnected to room!")

def prewarm(proc: agents.JobProcess):
    """Preload models for faster startup"""
    proc.userdata["vad"] = silero.VAD.load()

if __name__ == "__main__":
    config = load_config()
    
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            shutdown_process_timeout=config["agent"].shutdown_timeout,
            agent_name=config["agent"].agent_name,
            worker_type=agents.worker.WorkerType.ROOM,  # Auto-join all rooms
        ),
    ) 