import json
import asyncio
import logging
from typing import AsyncIterable, Optional
from livekit import agents, rtc
from livekit.agents import stt, ModelSettings

logger = logging.getLogger("livekit.assistant.transcription")
# This transcription handler is templated - PLEASE update to optimise for your use case
class TranscriptionHandler:
    """Handles real-time transcription and broadcasting to participants"""
    
    def __init__(self, enable_transcription: bool = True):
        self.enable_transcription = enable_transcription
    
    async def process_stt_stream(
        self, 
        audio: AsyncIterable[rtc.AudioFrame], 
        model_settings: ModelSettings,
        agent_instance
    ) -> Optional[AsyncIterable[stt.SpeechEvent]]:
        """Process STT audio stream and broadcast transcriptions"""
        
        if not self.enable_transcription:
            # Just pass through to default STT if transcription is disabled
            async for event in agent_instance.default_stt_node(audio, model_settings):
                yield event
            return
        
        job_ctx = agents.get_job_context()
        room = job_ctx.room
        participant_name = room.local_participant.name or room.local_participant.identity
        
        logger.info(f"Starting transcription for participant: {participant_name}")
        
        async for event in agent_instance.default_stt_node(audio, model_settings):
            logger.debug(f"STT event: {event.type}")
            
            if event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                await self._handle_final_transcript(event, participant_name, room)
            elif event.type == stt.SpeechEventType.INTERIM_TRANSCRIPT:
                await self._handle_interim_transcript(event, participant_name, room)
                
            yield event
    
    async def _handle_final_transcript(self, event, participant_name: str, room):
        """Handle final transcript and broadcast to participants"""
        transcript_text = event.alternatives[0].text
        
        transcription_data = {
            "type": "live_transcription",
            "text": transcript_text,
            "speaker": participant_name,
            "timestamp": asyncio.get_event_loop().time(),
            "is_final": True
        }
        
        await self._broadcast_transcription(transcription_data, room, transcript_text)
    
    async def _handle_interim_transcript(self, event, participant_name: str, room):
        """Handle interim transcript and broadcast for live feedback"""
        interim_text = event.alternatives[0].text
        
        transcription_data = {
            "type": "live_transcription", 
            "text": interim_text,
            "speaker": participant_name,
            "timestamp": asyncio.get_event_loop().time(),
            "is_final": False
        }
        
        await self._broadcast_transcription(transcription_data, room, interim_text, is_interim=True)
    
    async def _broadcast_transcription(self, transcription_data: dict, room, text: str, is_interim: bool = False):
        """Broadcast transcription to all remote participants"""
        try:
            if room.remote_participants:
                for participant_identity, participant in room.remote_participants.items():
                    await room.local_participant.publish_data(
                        data=json.dumps(transcription_data).encode('utf-8'),
                        destination=[participant_identity],
                        topic="transcription"
                    )
                
                log_type = "interim" if is_interim else "final"
                logger.info(f"Sent {log_type} transcription to {len(room.remote_participants)} participants: '{text[:50]}...'")
            else:
                logger.warning("No remote participants to send transcription to")
                
        except Exception as e:
            error_type = "interim" if is_interim else "final"
            logger.error(f"Error sending {error_type} transcription data: {e}", exc_info=True) 