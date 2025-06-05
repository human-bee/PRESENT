import { NextRequest, NextResponse } from 'next/server';
import { createLiveKitAgentBridge, LiveKitAgentBridge } from "@/lib/livekit-agent-bridge";
import { AccessToken } from "livekit-server-sdk";
export const runtime = "nodejs";

// Store active agent instances (in production, use a proper state management solution)
const activeAgents = new Map<string, LiveKitAgentBridge>();

/**
 * POST /api/agent/dispatch
 * 
 * Triggers an OpenAI agent to join a LiveKit room
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
    
    // Check if agent is already in this room
    if (activeAgents.has(roomName)) {
      console.log(`🤖 Agent already active in room: ${roomName}`);
      return NextResponse.json({
        success: true,
        message: "Agent already active in room",
        roomName,
        agentIdentity: "tambo-voice-agent",
      });
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
    
    console.log(`🤖 Dispatching agent to room: ${roomName}`);
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
    
    // Create and connect the agent bridge
    try {
      const bridge = await createLiveKitAgentBridge({
        roomUrl: wsUrl,
        token,
        agentName,
        openaiApiKey,
      });
      
      // Store the active agent
      activeAgents.set(roomName, bridge);
      
      // Set up cleanup when agent disconnects
      const checkDisconnection = setInterval(() => {
        const status = bridge.getStatus();
        if (!status.livekit.connected) {
          console.log(`🤖 Agent disconnected from room: ${roomName}`);
          activeAgents.delete(roomName);
          clearInterval(checkDisconnection);
        }
      }, 5000); // Check every 5 seconds
      
      console.log(`✅ Agent successfully dispatched to room: ${roomName}`);
      
      return NextResponse.json({
        success: true,
        message: "Agent dispatched successfully",
        roomName,
        agentIdentity,
        status: bridge.getStatus(),
      });
      
    } catch (error) {
      console.error(`❌ Failed to dispatch agent:`, error);
      return NextResponse.json(
        { 
          error: "Failed to dispatch agent",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
    
  } catch (error) {
    console.error("❌ Agent dispatch error:", error);
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agent/dispatch?roomName=ROOM
 * 
 * Check agent status for a specific room
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roomName = searchParams.get("roomName");
  
  if (!roomName) {
    // Return all active agents
    const activeRooms = Array.from(activeAgents.entries()).map(([room, bridge]) => ({
      roomName: room,
      status: bridge.getStatus(),
    }));
    
    return NextResponse.json({
      activeAgents: activeRooms,
      count: activeRooms.length,
    });
  }
  
  // Check specific room
  const bridge = activeAgents.get(roomName);
  if (!bridge) {
    return NextResponse.json({
      roomName,
      agentActive: false,
      message: "No agent in room",
    });
  }
  
  return NextResponse.json({
    roomName,
    agentActive: true,
    status: bridge.getStatus(),
  });
} 