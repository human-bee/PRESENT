from dotenv import load_dotenv

from livekit import agents
from livekit.agents import Agent, AgentSession, RoomInputOptions, RoomOutputOptions, JobContext, RunContext # Added JobContext
from livekit.plugins import (
    openai,
    groq,
    noise_cancellation,
    silero,
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from livekit.agents import function_tool # get_job_context is implicitly available via JobContext in entrypoint
from typing import Any, List
import json
from livekit.agents.llm import ChatContext, ChatMessage, LLM # Added LLM for type hint

from livekit.agents import ModelSettings, llm, FunctionTool, Agent
from typing import AsyncIterable
from collections.abc import AsyncGenerator, AsyncIterable, Coroutine

load_dotenv(override=True)

import os
import logging

# Configure logging for better insight during development and operation
# logging.basicConfig(level=logging.DEBUG) # Use DEBUG for very verbose output
# logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("livekit.assistant") # More specific logger name
logger.setLevel(logging.INFO)


class ConversationalAssistant(Agent): # Renamed for clarity
    def __init__(self) -> None: # Expect LLM to be passed for respond_with_voice context
        super().__init__(instructions="""
        You are an advanced AI assistant, silently participating in a multi-user voice conversation.
        Your primary directive is to meticulously listen to and understand the ongoing discussion.
        You DO NOT speak or send text messages into the call UNLESS you are directly addressed by a user
        and the query specifically requires a spoken response that cannot be fulfilled by another tool;
        in such specific cases, and only then, you will use the 'respond_with_voice' tool.

        Your main function is to act as an intelligent dispatcher for a frontend AI.
        After each user's turn, you MUST select and call one of your available tools.
        Most of the time, if no specific action or information is needed to augment the conversation,
        you will call the 'do_nothing' tool.

        When the conversation indicates that external information, a creative generation,
        or a specific task could be beneficial, you will choose the appropriate tool
        (e.g., 'generate_Youtube_task_prompt', 'generate_image_creation_task_prompt', etc.).
        For tools that dispatch tasks to the frontend AI (like 'generate_Youtube_task_prompt'),
        your role is to generate a detailed 'action_plan' string as the sole argument for that tool.
        This 'action_plan' IS the comprehensive prompt that will be sent to the frontend AI.
        It must be a self-contained, natural language, multi-step instruction, rich in context
        from the *current* conversation, and clearly articulate what the frontend AI needs to do,
        including which of its own tools to use, with what parameters, in what order,
        and what the final output should be.

        Key Responsibilities:
        1.  ALWAYS call a tool after each user turn. If unsure, or no action is needed, call 'do_nothing'.
        2.  Be an acute listener. Understand user intent, nuanced requests, and conversational flow.
        3.  For tools that dispatch tasks to the frontend AI by generating an 'action_plan':
            - Your primary task is to dynamically construct this 'action_plan' string based on the live conversation.
            - Ensure the 'action_plan' is a complete, standalone instruction set for the frontend AI,
              formulated as clear, natural language steps.
            - Consult the specific tool's description for detailed guidance on how to structure the 'action_plan'
              for that particular type of task (e.g., the 'generate_Youtube_task_prompt' tool's description
              will detail how to formulate a YouTube action plan using MCP server knowledge).
        4.  Only use 'respond_with_voice' if a user directly speaks to *you* (the AI assistant)
            and asks a question or makes a request that necessitates a spoken reply and cannot be
            addressed by dispatching a task to the frontend AI. Avoid chit-chat.
        5.  Do not proactively offer suggestions or interject unless a tool's specific purpose is to do so
            (and even then, it's by generating an 'action_plan' for the frontend AI, not by speaking yourself).
        """)

        # async def llm_node(
        #     agent: Agent,
        #     chat_ctx: llm.ChatContext,
        #     tools: list[FunctionTool],
        #     model_settings: ModelSettings,
        # ) -> AsyncGenerator[llm.ChatChunk | str, None]:
        #     """Default implementation for `Agent.llm_node`"""
        #     logger.info("llm_node called")
        #     activity = agent._get_activity_or_raise()
        #     assert activity.llm is not None, "llm_node called but no LLM node is available"
        #     assert isinstance(activity.llm, llm.LLM), (
        #         "llm_node should only be used with LLM (non-multimodal/realtime APIs) nodes"
        #     )

        #     tool_choice = model_settings.tool_choice if model_settings else NOT_GIVEN
        #     activity_llm = activity.llm

        #     async with activity_llm.chat(
        #         chat_ctx=chat_ctx, tools=tools, tool_choice=tool_choice
        #     ) as stream:
        #         async for chunk in stream:
        #             # yield chunk
                    
        #             is_text_response = False
        #             if hasattr(chunk, 'delta') and chunk.delta and hasattr(chunk.delta, 'content') and chunk.delta.content:
        #                 logger.info(f"LLM tried to respond with text, suppressing: '{getattr(chunk.delta, 'content', '')}'")
        #                 is_text_response = True

        #             # If your LLM might also put tool calls in `chunk.choices[0].delta.tool_calls`
        #             is_tool_call_request = False
        #             if hasattr(chunk, 'delta') and chunk.delta and hasattr(chunk.delta, 'tool_calls') and chunk.delta.tool_calls:
        #                 logger.info(f"LLM tried to call a tool: '{getattr(chunk.delta, 'tool_calls', '')}'")
        #                 is_tool_call_request = True
        #             elif hasattr(chunk, 'choices') and chunk.choices and \
        #                 hasattr(chunk.choices[0], 'delta') and chunk.choices[0].delta and \
        #                 hasattr(chunk.choices[0].delta, 'tool_calls') and chunk.choices[0].delta.tool_calls:
        #                 logger.info(f"LLM tried to call a tool: '{getattr(chunk.choices[0].delta, 'tool_calls', '')}'")
        #                 is_tool_call_request = True


        #             if is_text_response and not is_tool_call_request:
        #                 # This is a textual response from the LLM. Suppress it by not yielding it.
        #                 logger.info(f"LLM tried to respond with text, suppressing: '{getattr(chunk.delta, 'content', '')}'")
        #                 pass # Do not yield this chunk
        #             else:
        #                 # This is likely a tool call request, or some other control message. Forward it.
        #                 logger.info(f"LLM tried to call a tool: '{getattr(chunk.choices[0].delta, 'tool_calls', '')}'")
        #                 yield chunk

    async def on_user_turn_completed(
        self, turn_ctx: ChatContext, new_message: ChatMessage,
    ) -> None:
        """
        Callback triggered after each complete turn of a user's speech.
        The AgentSession's LLM will process `turn_ctx.history` (which includes `new_message`)
        and decide which function_tool to call based on the agent's system instructions.
        """
        pass
        logger.info(f"User turn completed. Message: \"{new_message}\". Processing with LLM for tool call.")
        # The main LLM processing loop in AgentSession will handle the tool calling.

    @function_tool()
    async def do_nothing(
        self,
        context: RunContext,
    ) -> dict[str, Any]:
        """
        Call this essential tool if, after analyzing the latest user turn and the overall conversation,
        you determine that no other specific action, information retrieval, or task generation
        is necessary or would meaningfully contribute to the conversation at this precise moment.
        This is your default 'no-op' action.

        Args:
            None
        """
        logger.info("Tool 'do_nothing' called: No proactive task generation or response deemed necessary by the LLM.")
        return {"status": "SUCCESS", "message": "No action was taken, as per LLM decision."}

    @function_tool()
    async def respond_with_voice(
        self,
        context: RunContext,
        spoken_message: str,
        justification_for_speaking: str,
    ) -> dict[str, Any]:
        """
        Use this tool ONLY when a user directly addresses you (the AI assistant) and asks a question
        or makes a request that absolutely requires a direct, spoken response from you, and this
        response cannot be fulfilled by dispatching a task to the frontend AI via another tool.
        For example, if a user asks "AI, what can you do?". Be concise and to the point.

        Args:
            spoken_message (str): The exact message you will speak in response.
            justification_for_speaking (str): A brief explanation of why a spoken response from you is essential here,
                                              confirming direct address and necessity.
        """
        logger.info(f"Tool 'respond_with_voice' called. Justification: '{justification_for_speaking}'. Message: '{spoken_message}'")
        try:
            await self.session.say(spoken_message, allow_interruptions=True)
            logger.info(f"LLM has determined a spoken response is necessary. Message to be spoken: '{spoken_message}'")
            # No direct action here, the LLM's decision to call this and provide `spoken_message` means it will be spoken.
            return {"status": "SUCCESS", "message": f"Acknowledged request to speak. The LLM will provide the voice response: {spoken_message}"}

        except Exception as e:
            logger.error(f"Error in 'respond_with_voice' tool: {e}", exc_info=True)
            return {"status": "ERROR", "message": f"Could not process voice response: {str(e)}"}

    async def _send_task_to_frontend(self, task_type: str, task_prompt: str, rpc_payload_extras: dict = None, method: str = "executeFrontendAITask") -> dict[str, Any]:
        """Helper function to dispatch tasks to the frontend AI via RPC."""
        job_ctx = agents.get_job_context() # More robust way to get JobContext
        room = job_ctx.room

        if not room.remote_participants:
            logger.warning(f"Attempted to send '{task_type}' task, but no remote participants found.")
            return {"status": "ERROR", "message": "No remote participants to send the task to."}

        # Determine destination: simplistic (first remote participant).
        # In a real app, you'd identify the specific frontend participant.
        destination_identity = next(iter(room.remote_participants)) # TODO: Make this configurable or more robust

        payload = {
            "task_type": task_type,
            "task_prompt": task_prompt,
        }
        if rpc_payload_extras:
            payload.update(rpc_payload_extras)

        logger.info(f"Dispatching task '{task_type}' to frontend participant '{destination_identity}'. Prompt: {task_prompt[:200]}...") # Log snippet
        try:
            # Assuming local_participant is this agent
            response_from_frontend = await room.local_participant.perform_rpc(
                destination_identity=destination_identity,
                method=method, # Standardized RPC method name on the frontend
                payload=json.dumps(payload),
                response_timeout=60.0, # Increased timeout for potentially complex frontend tasks
            )
            logger.info(f"RPC response for task '{task_type}' from frontend: {response_from_frontend}")
            return {"status": "SUCCESS", "message": f"Task '{task_type}' successfully dispatched.", "frontend_response": response_from_frontend}
        except TimeoutError:
            logger.error(f"Timeout waiting for RPC response for task '{task_type}' from '{destination_identity}'.")
            return {"status": "ERROR", "message": f"RPC timeout for task '{task_type}'."}
        except Exception as e:
            logger.error(f"Error sending RPC for task '{task_type}' to '{destination_identity}': {e}", exc_info=True)
            return {"status": "ERROR", "message": f"RPC error for task '{task_type}': {str(e)}"}

    @function_tool()
    async def generate_Youtube_task_prompt(
        self,
        context: RunContext,
        action_plan: str,
    ) -> dict[str, Any]:
        """
        Call this tool when the conversation indicates a YouTube-related task is needed.
        You must formulate a comprehensive 'action_plan' (as a natural language, multi-step text string)
        based on the conversation and your knowledge of how the frontend's YouTube MCP (Model Context Protocol) server works.
        This tool's role is to dispatch this 'action_plan' to the frontend AI.

        **YouTube MCP Server Capabilities (for your 'action_plan' construction):**
        The frontend AI has access to the following YouTube MCP tools. Your 'action_plan' should instruct the frontend
        to use these tools appropriately:
        - `searchVideos`: Searches for videos.
            - Params: `query` (str, required), `maxResults` (int, optional, e.g., 3-5).
        - `getVideoDetails`: Gets details for specific videos.
            - Params: `videoIds` (array of str, required).
        - `getTranscripts`: Retrieves video transcripts.
            - Params: `videoIds` (array of str, required), `lang` (str, optional, e.g., 'en', 'ko').
        - `getRelatedVideos`: Finds videos related to a given video.
            - Params: `videoId` (str, required), `maxResults` (int, optional).
        - `getChannelStatistics`: Fetches statistics for channels.
            - Params: `channelIds` (array of str, required).
        - `getChannelTopVideos`: Gets a channel's top videos.
            - Params: `channelId` (str, required), `maxResults` (int, optional).
        - `getVideoEngagementRatio`: Calculates engagement for videos.
            - Params: `videoIds` (array of str, required).
        - `getTrendingVideos`: Gets trending videos by region/category.
            - Params: `regionCode` (str, optional), `categoryId` (str, optional), `maxResults` (int, optional).
        - `compareVideos`: Compares statistics across multiple videos.
            - Params: `videoIds` (array of str, required).

        **Constructing Your 'action_plan' (Natural Language Multi-Step Instructions):**
        Your 'action_plan' string should clearly guide the frontend AI. Structure it with the following considerations:
        1.  **State the User's Need:** Start by briefly describing what YouTube-related information or action the user is
            implicitly or explicitly asking for based on the conversation.
            (e.g., "The user wants to find videos about learning to play guitar.")
        2.  **Specify MCP Tool(s) and Parameters:** Clearly state which MCP tool(s) the frontend should call.
            For each tool, specify all necessary parameters, deriving values from the conversation.
            (e.g., "First, instruct the frontend to call `searchVideos` with the query 'beginner guitar lessons' and maxResults 3.")
        3.  **Define Sequence (if multi-step):** If multiple MCP calls are needed, describe the order. Explain how data from
            one step might be used in the next.
            (e.g., "Then, for each video ID obtained from the search, instruct the frontend to call `getVideoDetails`.")
        4.  **Detail Desired Output from Frontend:** Explain precisely what information the frontend AI should extract from
            the MCP tool results and how it should be structured or summarized for presentation.
            (e.g., "From the video details, the frontend should provide the video title, its direct URL,
             and a brief 1-2 sentence summary of the video's description. Also, ask for the view count.")
        5.  **Include Conversational Context/Rationale:** Briefly explain *why* this specific action_plan and the requested
            information are relevant to the current point in the conversation.
            (e.g., "This is relevant because the user just expressed interest in picking up a new musical hobby.")

        **Example of a natural language 'action_plan' string:**:
        The user is asking for funny cat videos to lighten the mood.
        Here's the plan for the frontend:
        1. Call the `searchVideos` MCP tool. Use 'funny cat videos' as the query and set maxResults to 3.
        2. For each of the video IDs returned by `searchVideos`:
           Call the `getVideoDetails` MCP tool to get more information.
        3. From the details of each video, extract and present:
           - The video title.
           - The direct YouTube URL.
           - A very brief, 1-sentence summary of what the video is about.
        This is needed because the conversation was getting a bit heavy, and someone suggested watching something funny.

        Args:
            action_plan (str): A detailed, natural language, multi-step plan, generated by your core LLM.
                               This plan instructs the frontend AI on exactly how to perform
                               the YouTube search using its MCP server tools, including parameters,
                               sequence, and desired output format.
        """
        logger.info(f"Tool 'generate_Youtube_task_prompt' called. Dispatching provided action_plan to frontend.")
        # The action_plan is now the fully-formed prompt for the frontend AI.
        frontend_task = asyncio.create_task(self._send_task_to_frontend(
            task_type="Youtube",  # This still helps categorize the task broadly
            task_prompt=action_plan,  # The LLM-generated action_plan is sent directly
            rpc_payload_extras={}, # Potentially add generic info if needed, or keep empty
            method="youtubeSearch" # The frontend route that handles YouTube MCP interactions
        ))
        try:
            result = await frontend_task
        except asyncio.CancelledError:
            result = {"status": "ERROR", "message": "Youtube task cancelled by user"}
        finally:
            frontend_task.cancel()
            return result

async def entrypoint(ctx: JobContext):
    session = AgentSession(
        llm=openai.LLM(
            model="gpt-4.1-nano",
            # tool_choice="required"
        ),
        stt=groq.STT(
            model="whisper-large-v3-turbo", # Fast and accurate STT
            language="en",
        ),
        tts=openai.TTS( # TTS is configured for the `respond_with_voice` tool
            model="tts-1", # Standard OpenAI TTS model
        ),
        vad=silero.VAD.load(), # Voice Activity Detection
        turn_detection=MultilingualModel(), # Turn detection
    )

    logger.info("creating ConversationalAssistant...")
    assistant = ConversationalAssistant()
    logger.info("Starting AgentSession...")
    await session.start(
        room=ctx.room,
        agent=assistant,
        room_input_options=RoomInputOptions(
            text_enabled=True,
            audio_enabled=True,
            noise_cancellation=noise_cancellation.BVC(),
        ),
        room_output_options=RoomOutputOptions(
            transcription_enabled=True,
            audio_enabled=True
        ),
    )
    logger.info("AgentSession started")

    await ctx.connect()

    # await session.generate_reply("")
    await session.generate_reply(
        instructions="Greet the user and offer your assistance."
    )

def prewarm(proc: agents.JobProcess):
    proc.userdata["vad"] = silero.VAD.load(
        # activation_threshold=0.65,
        # min_speech_duration=0.1,
        # min_silence_duration=0.85,
        # min_silence_duration=2,
        # prefix_padding_duration=0.5,
    )

if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            shutdown_process_timeout=60 * 100,
        ),
    )
