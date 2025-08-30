import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

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
      // Create agent dispatch using LiveKit's Agent Dispatch Service
      const agentDispatchUrl = serverUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const dispatchUrl = `${agentDispatchUrl}/twirp/livekit.AgentDispatchService/CreateDispatch`;

      // Create admin token for the dispatch request with all necessary permissions
      const adminToken = new AccessToken(apiKey, apiSecret, {
        identity: 'system-admin',
        name: 'System Admin',
      });

      // Add comprehensive grants for agent dispatch
      adminToken.addGrant({
        room: roomName,
        roomJoin: true,
        roomAdmin: true,
        roomCreate: true,
        roomList: true,
        roomRecord: true,
        canPublish: true,
        canPublishData: true,
        canSubscribe: true,
        canUpdateOwnMetadata: true,
        ingressAdmin: true,
      });

      const token = await adminToken.toJwt();

      console.log('🚀 Dispatching agent to room:', roomName);
      console.log('📍 Dispatch URL:', dispatchUrl);

      const dispatchResponse = await fetch(dispatchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentName: 'voice-agent', // Changed to voice-agent-enhanced to experiment with Agentic Canvas Control
          room: roomName,
          metadata: JSON.stringify({
            dispatchedAt: Date.now(),
            reason: 'manual_dispatch',
          }),
        }),
      });

      if (!dispatchResponse.ok) {
        const errorText = await dispatchResponse.text();
        console.error('❌ Agent dispatch failed:', dispatchResponse.status, errorText);

        // Check if it's an authentication error
        if (dispatchResponse.status === 401) {
          console.error('🔐 Authentication failed - checking token permissions');
          console.log('Token grants:', {
            room: roomName,
            identity: 'system-admin',
          });
        }

        return NextResponse.json(
          {
            error: 'Agent dispatch failed',
            details: errorText,
            status: dispatchResponse.status,
          },
          { status: 500 },
        );
      }

      const dispatchResult = await dispatchResponse.json();
      console.log('✅ Agent dispatch successful:', dispatchResult);

      return NextResponse.json({
        success: true,
        message: 'Agent dispatched successfully',
        dispatch: dispatchResult,
        agentName: 'voice-agent',
        room: roomName,
      });
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
