import json
import asyncio
import logging
from typing import Any, Dict
from livekit import agents
from livekit.agents import function_tool, RunContext

logger = logging.getLogger("livekit.assistant.tools")

@function_tool()
async def do_nothing(context: RunContext) -> Dict[str, Any]:
    """
    Call this essential tool if, after analyzing the latest user turn and the overall conversation,
    you determine that no other specific action, information retrieval, or task generation
    is necessary or would meaningfully contribute to the conversation at this precise moment.
    This is your default 'no-op' action.
    """
    logger.info("Tool 'do_nothing' called - no action required")
    return {
        "status": "SUCCESS",
        "message": "No action required at this time",
        "action_taken": "none"
    }

@function_tool()
async def respond_with_voice(
    context: RunContext,
    spoken_message: str,
    justification_for_speaking: str,
) -> Dict[str, Any]:
    """
    Use this tool ONLY when a user directly addresses you (the AI assistant) and asks
    a question or makes a request that requires a spoken response that cannot be handled
    by dispatching a task to the frontend AI.
    
    Args:
        spoken_message (str): The message you want to speak to the user
        justification_for_speaking (str): Why you need to speak instead of using other tools
    """
    logger.info(f"Tool 'respond_with_voice' called with message: '{spoken_message[:100]}...'")
    
    # Get the agent session to speak
    job_ctx = agents.get_job_context()
    session = getattr(job_ctx, 'session', None)
    
    if session:
        try:
            await session.say(spoken_message)
            logger.info("Voice response sent successfully")
            return {
                "status": "SUCCESS", 
                "message": "Voice response sent", 
                "spoken_message": spoken_message,
                "justification": justification_for_speaking
            }
        except Exception as e:
            logger.error(f"Error sending voice response: {e}")
            return {
                "status": "ERROR", 
                "message": f"Failed to send voice response: {str(e)}"
            }
    else:
        logger.warning("No session available for voice response")
        return {
            "status": "ERROR", 
            "message": "No session available for voice response"
        }

async def send_task_to_frontend(task_type: str, task_prompt: str, method: str = "executeFrontendAITask") -> Dict[str, Any]:
    """Helper function to dispatch tasks to the frontend AI via RPC."""
    job_ctx = agents.get_job_context()
    room = job_ctx.room

    if not room.remote_participants:
        logger.warning(f"Attempted to send '{task_type}' task, but no remote participants found.")
        return {"status": "ERROR", "message": "No remote participants to send the task to."}

    for destination_identity in room.remote_participants:
        payload = {
            "task_type": task_type,
            "task_prompt": task_prompt,
        }

        logger.info(f"Dispatching task '{task_type}' to frontend participant '{destination_identity}'. Prompt: {task_prompt[:100]}...")
        try:
            response_from_frontend = await room.local_participant.perform_rpc(
                destination_identity=destination_identity,
                method=method,
                payload=json.dumps(payload),
                response_timeout=60.0,
            )
            logger.info(f"RPC response for task '{task_type}' from frontend: {response_from_frontend}")
            return {
                "status": "SUCCESS", 
                "message": f"Task '{task_type}' successfully dispatched.", 
                "frontend_response": response_from_frontend
            }
        except TimeoutError:
            logger.error(f"Timeout waiting for RPC response for task '{task_type}' from '{destination_identity}'.")
            return {"status": "ERROR", "message": f"RPC timeout for task '{task_type}'."}
        except Exception as e:
            logger.error(f"Error sending RPC for task '{task_type}' to '{destination_identity}': {e}", exc_info=True)
            return {"status": "ERROR", "message": f"RPC error for task '{task_type}': {str(e)}"}

@function_tool()
async def generate_youtube_task_prompt(
    context: RunContext,
    action_plan: str,
) -> Dict[str, Any]:
    """
    Call this tool when the conversation indicates a YouTube-related task is needed.
    You must formulate a comprehensive 'action_plan' (as a natural language, multi-step text string)
    based on the conversation and your knowledge of how the frontend's YouTube MCP server works.

    Args:
        action_plan (str): A detailed, natural language, multi-step plan that instructs
                          the frontend AI on exactly how to perform the YouTube search
                          using its MCP server tools, including parameters, sequence, 
                          and desired output format.
    """
    logger.info(f"Tool 'generate_youtube_task_prompt' called. Dispatching action_plan to frontend.")
    
    frontend_task = asyncio.create_task(send_task_to_frontend(
        task_type="Youtube",
        task_prompt=action_plan,
        method="youtubeSearch"
    ))
    
    try:
        result = await frontend_task
        return result
    except asyncio.CancelledError:
        return {"status": "ERROR", "message": "Youtube task cancelled by user"}
    finally:
        if not frontend_task.done():
            frontend_task.cancel()

# Tool registry for easy management
AVAILABLE_TOOLS = [
    do_nothing,
    respond_with_voice, 
    generate_youtube_task_prompt,
] 