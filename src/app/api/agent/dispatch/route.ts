import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from "livekit-server-sdk";

export const runtime = "nodejs";

/**
 * POST /api/agent/dispatch
 * 
 * Creates a token for an agent to join a LiveKit room.
 * The actual agent runs as a separate Node.js process.
 * 
 * Request body:
 * - roomName: string - The name of the room to join
 * - trigger: string - What triggered the request (e.g., 'participant_connected')
 * - timestamp: number - When the trigger occurred
 */
export async function POST(req: NextRequest) {
  try {
    const { roomName, trigger, timestamp } = await req.json();
    
    if (!roomName) {
      return NextResponse.json(
        { error: "Missing required parameter: roomName" },
        { status: 400 }
      );
    }
    
    // Check for required environment variables
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "Server misconfigured: missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET" },
        { status: 500 }
      );
    }
    
    if (!wsUrl) {
      return NextResponse.json(
        { error: "Server misconfigured: missing LIVEKIT_URL" },
        { status: 500 }
      );
    }
    
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }
    
    console.log(`🤖 Creating agent token for room: ${roomName}`);
    console.log(`🎯 Trigger: ${trigger} at ${new Date(timestamp).toISOString()}`);
    
    // Generate agent token for LiveKit
    const agentIdentity = "tambo-voice-agent";
    const agentName = "Tambo Voice Agent";
    
    const at = new AccessToken(apiKey, apiSecret, {
      identity: agentIdentity,
      name: agentName,
      metadata: JSON.stringify({
        type: "agent",
        model: "openai-realtime",
        trigger,
        dispatchTime: Date.now(),
      }),
    });
    
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canUpdateOwnMetadata: true,
    });
    
    const token = await at.toJwt();
    
    // Return success with agent info
    // The actual agent should be running separately and will use this token
    console.log(`✅ Agent token created for room: ${roomName}`);
    
    return NextResponse.json({
      success: true,
      message: "Agent token created successfully",
      roomName,
      agentIdentity,
      token, // Include token for debugging/manual agent connection
      wsUrl,
      note: "The agent should be running as a separate process. See TYPESCRIPT_AGENT_SETUP.md for instructions.",
    });
    
  } catch (error) {
    console.error(`❌ Failed to create agent token:`, error);
    return NextResponse.json(
      { 
        error: "Failed to create agent token",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agent/dispatch
 * 
 * Health check endpoint
 */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: "ok",
    message: "Agent dispatch API is running",
    note: "Use POST to create agent tokens. The agent should run as a separate process.",
  });
} 