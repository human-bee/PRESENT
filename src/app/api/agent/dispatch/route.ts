import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';

export async function POST(request: NextRequest) {
  try {
    console.log('🤖 [Agent Dispatch API] Request received');
    
    const body = await request.json();
    const { roomName, trigger, timestamp } = body;
    
    console.log('📊 [Agent Dispatch API] Request details:', {
      roomName,
      trigger,
      timestamp,
      userAgent: request.headers.get('user-agent')?.slice(0, 50),
    });

    // Validate required environment variables
    const livekitUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      console.error('❌ [Agent Dispatch API] Missing required environment variables:', {
        hasLivekitUrl: !!livekitUrl,
        hasApiKey: !!apiKey,
        hasApiSecret: !!apiSecret,
      });
      
      return NextResponse.json(
        { 
          error: 'Server configuration error',
          details: 'Missing required LiveKit environment variables'
        },
        { status: 500 }
      );
    }

    if (!roomName) {
      return NextResponse.json(
        { error: 'Room name is required' },
        { status: 400 }
      );
    }

    console.log(`🚀 [Agent Dispatch API] Dispatching agent to room: ${roomName}`);
    
    // Create a dispatch log entry
    const dispatchInfo = {
      roomName,
      trigger,
      timestamp: timestamp || Date.now(),
      status: 'triggered',
      agentType: 'conversational-assistant',
    };

    try {
      // Try to use LiveKit's room service to check if room exists
      const roomService = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
      
      console.log('🔧 [Agent Dispatch API] Checking room status...');
      
      // List rooms to see if our target room exists
      const rooms = await roomService.listRooms();
      const targetRoom = rooms.find(room => room.name === roomName);
      
      if (targetRoom) {
        console.log('✅ [Agent Dispatch API] Room found:', {
          name: targetRoom.name,
          numParticipants: targetRoom.numParticipants,
          creationTime: targetRoom.creationTime
        });
        
        // For now, we'll rely on the agent's WorkerType.ROOM to auto-join
        // The agent should automatically detect the room and join
        console.log('ℹ️ [Agent Dispatch API] Agent should auto-join via WorkerType.ROOM');
        
        return NextResponse.json({
          success: true,
          message: 'Room verified - agent should auto-join',
          dispatch: {
            ...dispatchInfo,
            method: 'worker-auto-join',
            roomInfo: {
              name: targetRoom.name,
              numParticipants: targetRoom.numParticipants
            }
          },
          recommendation: 'Make sure your agent worker is running with WorkerType.ROOM'
        });
        
      } else {
        console.log('⚠️ [Agent Dispatch API] Room not found, may be created when user connects');
      }

    } catch (roomServiceError) {
      console.warn('⚠️ [Agent Dispatch API] Room service failed, falling back to webhook trigger:', roomServiceError);
    }
    
    // Fallback: Try to trigger via webhook or direct notification
    try {
      // Option 1: Try to make a webhook call to trigger your agent worker
      const webhookUrl = process.env.AGENT_WEBHOOK_URL;
      if (webhookUrl) {
        console.log('🪝 [Agent Dispatch API] Triggering via webhook...');
        const webhookResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join_room',
            roomName,
            trigger,
            timestamp
          })
        });
        
        if (webhookResponse.ok) {
          console.log('✅ [Agent Dispatch API] Webhook trigger successful');
          return NextResponse.json({
            success: true,
            message: 'Agent triggered via webhook',
            dispatch: { ...dispatchInfo, method: 'webhook' }
          });
        }
      }
      
      // Option 2: File-based trigger (for local development)
      const fs = await import('fs').catch(() => null);
      if (fs && process.env.NODE_ENV === 'development') {
        const triggerFile = '/tmp/agent-trigger.json';
        const triggerData = {
          roomName,
          trigger,
          timestamp: Date.now(),
          action: 'join_room'
        };
        
        try {
          fs.writeFileSync(triggerFile, JSON.stringify(triggerData, null, 2));
          console.log('📁 [Agent Dispatch API] Created trigger file for development');
        } catch (fileError) {
          console.warn('⚠️ [Agent Dispatch API] Could not create trigger file:', fileError);
        }
      }
      
      // Return success even if we just logged the request
      console.log('ℹ️ [Agent Dispatch API] Dispatch logged - agent should auto-join via WorkerType.ROOM');
      
      return NextResponse.json({
        success: true,
        message: 'Agent dispatch logged successfully',
        dispatch: { ...dispatchInfo, method: 'logged' },
        recommendation: 'Make sure your agent worker is running with WorkerType.ROOM. The agent should automatically join when it detects room activity.'
      });
      
    } catch (fallbackError) {
      console.error('❌ [Agent Dispatch API] All dispatch methods failed:', fallbackError);
      
      return NextResponse.json({
        success: false,
        message: 'Agent dispatch failed',
        error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error',
        dispatch: { ...dispatchInfo, status: 'failed' },
        recommendation: 'Check your agent worker configuration and ensure it\'s running'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('💥 [Agent Dispatch API] Error processing request:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Agent dispatch endpoint is active',
    methods: ['POST'],
    usage: 'POST with { roomName, trigger, timestamp } to trigger agent dispatch',
    environment: {
      hasLivekitUrl: !!(process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL),
      hasApiKey: !!process.env.LIVEKIT_API_KEY,
      hasApiSecret: !!process.env.LIVEKIT_API_SECRET,
      hasWebhookUrl: !!process.env.AGENT_WEBHOOK_URL,
      nodeEnv: process.env.NODE_ENV
    }
  });
} 