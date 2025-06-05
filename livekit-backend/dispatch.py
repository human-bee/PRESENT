import asyncio
from livekit import api

from dotenv import load_dotenv

load_dotenv(override=True)

room_name = "ROOM" # Placeholder - please update to reflect room used in current directory setup
agent_name = "Jaime AI" # Placeholder - please update to reflect agent used in current directory setup

async def create_explicit_dispatch():
    lkapi = api.LiveKitAPI()
    dispatch = await lkapi.agent_dispatch.create_dispatch(
        api.CreateAgentDispatchRequest(
            agent_name=agent_name, room=room_name, metadata='{"user_id": "12345"}'
        )
    )
    print("created dispatch", dispatch)

    dispatches = await lkapi.agent_dispatch.list_dispatch(room_name=room_name)
    print(f"there are {len(dispatches)} dispatches in {room_name}")
    await lkapi.aclose()

asyncio.run(create_explicit_dispatch())