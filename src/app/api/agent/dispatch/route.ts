import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

export const runtime = "nodejs";

/**
 * Clean Agent Dispatch API - Back to First Principles
 * 
 * For manual testing only. The real solution is automatic dispatch from LiveKit Cloud.
 */
export async function POST(request: NextRequest) {
  try {
    const { roomName } = await request.json();
    
    console.log('📥 Manual agent dispatch request:', { roomName });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const serverUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL;

    if (!apiKey || !apiSecret || !serverUrl) {
      return NextResponse.json(
        { error: 'Missing LiveKit credentials' },
        { status: 500 }
      );
    }

    if (!roomName) {
      return NextResponse.json(
        { error: 'Room name is required' },
        { status: 400 }
      );
    }

    // Create agent token (for manual testing only)
    const token = new AccessToken(apiKey, apiSecret, {
      identity: `test-agent-${Date.now()}`,
      name: 'Test Agent'
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const agentToken = await token.toJwt();

    console.log('✅ Manual agent token created for testing');

    return NextResponse.json({
      success: true,
      message: 'Manual dispatch token created (for testing only)',
      note: 'Real solution: automatic dispatch should work without this API',
      token: agentToken,
      serverUrl
    });

  } catch (error) {
    console.error('❌ Manual dispatch error:', error);
    return NextResponse.json(
      { error: 'Failed to create manual dispatch token' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Clean agent dispatch API",
    note: "This is for manual testing only. Automatic dispatch should work without this API."
  });
} 