import { NextRequest, NextResponse } from 'next/server';
import { AgentDispatchClient } from 'livekit-server-sdk';

export const runtime = 'nodejs';

/**
 * Agent Dispatch API - Manually dispatch agent to room
 *
 * Uses LiveKit's Agent Dispatch Service to explicitly request an agent join a room
 */
export async function POST(request: NextRequest) {
  try {
    const { roomName } = await request.json();

    console.log('📥 Agent dispatch request:', { roomName });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const serverUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL;

    if (!apiKey || !apiSecret || !serverUrl) {
      return NextResponse.json({ error: 'Missing LiveKit credentials' }, { status: 500 });
    }

    if (!roomName) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }

    try {
      // Use official AgentDispatchClient from livekit-server-sdk
      const agentDispatchUrl = serverUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const client = new AgentDispatchClient(agentDispatchUrl, apiKey, apiSecret);
      console.log('🚀 Creating agent dispatch via SDK:', { agentDispatchUrl, roomName, agentName: 'voice-agent' });
      const dispatch = await client.createDispatch(roomName, 'voice-agent', {
        metadata: JSON.stringify({ dispatchedAt: Date.now(), reason: 'manual_dispatch' }),
      });
      console.log('✅ Agent dispatch successful:', dispatch);
      return NextResponse.json({ success: true, dispatch, agentName: 'voice-agent', room: roomName });
    } catch (dispatchError) {
      console.error('❌ Agent dispatch error:', dispatchError);

      return NextResponse.json(
        {
          error: 'Failed to dispatch agent',
          details: dispatchError instanceof Error ? dispatchError.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('❌ Dispatch API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Clean agent dispatch API',
    note: 'This is for manual testing only. Automatic dispatch should work without this API.',
  });
}
