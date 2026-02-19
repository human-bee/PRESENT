import { NextRequest, NextResponse } from 'next/server';
import { AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import { createLogger } from '@/lib/logging';

export const runtime = 'nodejs';
const logger = createLogger('api:agent:dispatch');
const dispatchRequestSchema = z.object({
  roomName: z.string().min(1),
});
const DISPATCH_DEDUP_WINDOW_MS = 12_000;
const DISPATCH_CACHE_KEY = '__present_recent_agent_dispatch__';

type DispatchCache = Map<string, number>;

const getDispatchCache = (): DispatchCache => {
  const globalState = globalThis as Record<string, unknown>;
  const cached = globalState[DISPATCH_CACHE_KEY];
  if (cached instanceof Map) return cached as DispatchCache;
  const map: DispatchCache = new Map();
  globalState[DISPATCH_CACHE_KEY] = map;
  return map;
};

const normalizeIdentity = (value: string) => value.trim().toLowerCase();

const isAgentParticipantIdentity = (identity: string, agentName: string): boolean => {
  const normalizedIdentity = normalizeIdentity(identity);
  const normalizedAgentName = normalizeIdentity(agentName);
  if (!normalizedIdentity) return false;
  if (normalizedIdentity === normalizedAgentName) return true;
  if (normalizedIdentity.startsWith(`${normalizedAgentName}-`)) return true;
  return (
    normalizedIdentity.includes('voice-agent') ||
    normalizedIdentity.startsWith('agent-') ||
    normalizedIdentity.includes(':agent')
  );
};

const pruneDispatchCache = (cache: DispatchCache, nowMs: number) => {
  for (const [key, timestampMs] of cache.entries()) {
    if (nowMs - timestampMs > DISPATCH_DEDUP_WINDOW_MS * 2) {
      cache.delete(key);
    }
  }
};

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
      const roomClient = new RoomServiceClient(agentDispatchUrl, apiKey, apiSecret);
      const agentName =
        (process.env.LIVEKIT_VOICE_AGENT_NAME || process.env.LIVEKIT_AGENT_NAME || 'voice-agent').trim();
      const dedupeKey = `${normalizedRoomName}::${agentName}`;
      const dispatchCache = getDispatchCache();
      const nowMs = Date.now();
      pruneDispatchCache(dispatchCache, nowMs);

      const recentDispatchAt = dispatchCache.get(dedupeKey);
      if (typeof recentDispatchAt === 'number' && nowMs - recentDispatchAt < DISPATCH_DEDUP_WINDOW_MS) {
        logger.info('agent dispatch deduped by recent cooldown', {
          roomName: normalizedRoomName,
          agentName,
          elapsedMs: nowMs - recentDispatchAt,
        });
        return NextResponse.json({
          success: true,
          deduped: true,
          reason: 'recent_dispatch',
          agentName,
          room: normalizedRoomName,
        });
      }

      try {
        const participants = await roomClient.listParticipants(normalizedRoomName);
        const alreadyJoined = participants.some((participant) =>
          isAgentParticipantIdentity(participant.identity ?? '', agentName),
        );
        if (alreadyJoined) {
          dispatchCache.set(dedupeKey, nowMs);
          logger.info('agent dispatch skipped; agent participant already joined', {
            roomName: normalizedRoomName,
            agentName,
          });
          return NextResponse.json({
            success: true,
            deduped: true,
            reason: 'agent_already_joined',
            alreadyJoined: true,
            agentName,
            room: normalizedRoomName,
          });
        }
      } catch (participantError) {
        logger.debug('agent participant pre-check failed', {
          roomName: normalizedRoomName,
          error:
            participantError instanceof Error ? participantError.message : String(participantError),
        });
      }

      try {
        const existingDispatches = await client.listDispatch(normalizedRoomName);
        const existingDispatch = existingDispatches.find(
          (dispatch) => normalizeIdentity(dispatch.agentName ?? '') === normalizeIdentity(agentName),
        );
        if (existingDispatch) {
          dispatchCache.set(dedupeKey, nowMs);
          logger.info('agent dispatch skipped; active dispatch already exists', {
            roomName: normalizedRoomName,
            agentName,
            dispatchId: existingDispatch.id,
          });
          return NextResponse.json({
            success: true,
            deduped: true,
            reason: 'existing_dispatch',
            dispatch: existingDispatch,
            agentName,
            room: normalizedRoomName,
          });
        }
      } catch (listError) {
        logger.debug('listDispatch pre-check failed', {
          roomName: normalizedRoomName,
          error: listError instanceof Error ? listError.message : String(listError),
        });
      }

      logger.info('creating agent dispatch', {
        agentDispatchUrl,
        roomName: normalizedRoomName,
        agentName,
      });
      const dispatch = await client.createDispatch(normalizedRoomName, agentName, {
        metadata: JSON.stringify({ dispatchedAt: nowMs, reason: 'manual_dispatch' }),
      });
      dispatchCache.set(dedupeKey, nowMs);
      logger.info('agent dispatch succeeded', { roomName: normalizedRoomName });
      return NextResponse.json({
        success: true,
        dispatch,
        agentName,
        room: normalizedRoomName,
      });
    } catch (dispatchError) {
      const dispatchMessage = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
      if (/already exists|already dispatched|duplicate/i.test(dispatchMessage)) {
        logger.warn('agent dispatch duplicate detected after createDispatch error', {
          roomName: normalizedRoomName,
          error: dispatchMessage,
        });
        return NextResponse.json({
          success: true,
          deduped: true,
          reason: 'duplicate_dispatch_error',
          agentName:
            (process.env.LIVEKIT_VOICE_AGENT_NAME || process.env.LIVEKIT_AGENT_NAME || 'voice-agent').trim(),
          room: normalizedRoomName,
        });
      }
      logger.error('agent dispatch failed', {
        error: dispatchMessage,
      });

      return NextResponse.json(
        {
          error: 'Failed to dispatch agent',
          details: dispatchMessage,
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
