import { NextRequest, NextResponse } from 'next/server';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { z } from 'zod';
import { createLogger } from '@/lib/logging';

export const runtime = 'nodejs';
const logger = createLogger('api:agent:dispatch');
const dispatchRequestSchema = z.object({
  roomName: z.string().min(1),
});

/**
 * Agent Dispatch API - Manually dispatch agent to room
 *
 * Uses LiveKit's Agent Dispatch Service to explicitly request an agent join a room
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomName } = dispatchRequestSchema.parse(body);
    const normalizedRoomName = roomName.trim();
    if (!normalizedRoomName) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }
    logger.debug('dispatch request', { roomName: normalizedRoomName });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const serverUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL;

    if (!apiKey || !apiSecret || !serverUrl) {
      return NextResponse.json({ error: 'Missing LiveKit credentials' }, { status: 500 });
    }

    try {
      // Use official AgentDispatchClient from livekit-server-sdk
      const agentDispatchUrl = serverUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const client = new AgentDispatchClient(agentDispatchUrl, apiKey, apiSecret);
      logger.info('creating agent dispatch', {
        agentDispatchUrl,
        roomName: normalizedRoomName,
        agentName: 'voice-agent',
      });
      const dispatch = await client.createDispatch(normalizedRoomName, 'voice-agent', {
        metadata: JSON.stringify({ dispatchedAt: Date.now(), reason: 'manual_dispatch' }),
      });
      logger.info('agent dispatch succeeded', { roomName: normalizedRoomName });
      return NextResponse.json({
        success: true,
        dispatch,
        agentName: 'voice-agent',
        room: normalizedRoomName,
      });
    } catch (dispatchError) {
      logger.error('agent dispatch failed', {
        error:
          dispatchError instanceof Error ? dispatchError.message : 'Unknown dispatch error',
      });

      return NextResponse.json(
        {
          error: 'Failed to dispatch agent',
          details: dispatchError instanceof Error ? dispatchError.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }
    logger.error('dispatch api error', { error: error instanceof Error ? error.message : String(error) });
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
