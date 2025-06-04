import os
from typing import Dict, Any, List
from dataclasses import dataclass

@dataclass
class ModelConfig:
    """Configuration for AI models"""
    llm_model: str = "gpt-4.1-nano"
    stt_model: str = "whisper-large-v3-turbo"
    tts_model: str = "tts-1"
    stt_language: str = "en"

@dataclass
class AgentConfig:
    """Configuration for the conversational agent"""
    agent_name: str = "Tambo AI"
    max_tool_steps: int = 1
    enable_transcription: bool = True
    enable_voice_response: bool = True
    shutdown_timeout: int = 300  # 5 minutes

@dataclass
class SystemInstructions:
    """System instructions for the agent"""
    base_instructions: str = """
You are an advanced AI assistant participating in a multi-user voice conversation.
Your primary role is to listen, understand, and assist by calling appropriate tools.

Key Responsibilities:
1. Listen to conversations and understand user intent
2. ALWAYS call a tool after each user turn - use 'do_nothing' if no action is needed
3. For specific tasks, generate detailed action plans for the frontend AI
4. Only use 'respond_with_voice' when directly addressed and a spoken response is required
5. Dispatch tasks to frontend components via available tools

You help users by:
- Generating relevant content and components
- Performing research and analysis  
- Creating visualizations and interfaces
- Facilitating productive conversations
"""

def load_config() -> Dict[str, Any]:
    """Load configuration from environment variables and defaults"""
    return {
        "models": ModelConfig(
            llm_model=os.getenv("AGENT_LLM_MODEL", "gpt-4.1-nano"),
            stt_model=os.getenv("AGENT_STT_MODEL", "whisper-large-v3-turbo"),
            tts_model=os.getenv("AGENT_TTS_MODEL", "tts-1"),
            stt_language=os.getenv("AGENT_STT_LANGUAGE", "en"),
        ),
        "agent": AgentConfig(
            agent_name=os.getenv("AGENT_NAME", "Tambo AI"),
            max_tool_steps=int(os.getenv("AGENT_MAX_TOOL_STEPS", "1")),
            enable_transcription=os.getenv("AGENT_ENABLE_TRANSCRIPTION", "true").lower() == "true",
            enable_voice_response=os.getenv("AGENT_ENABLE_VOICE_RESPONSE", "true").lower() == "true",
            shutdown_timeout=int(os.getenv("AGENT_SHUTDOWN_TIMEOUT", "300")),
        ),
        "system": SystemInstructions(
            base_instructions=os.getenv("AGENT_SYSTEM_INSTRUCTIONS", SystemInstructions().base_instructions)
        )
    }

def get_chat_context() -> List[Dict[str, str]]:
    """Get initial chat context - can be configured or dynamic"""
    # For now, return empty context - this can be made configurable
    return [] 