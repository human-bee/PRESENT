import { createHash, timingSafeEqual } from 'crypto';
import type { AccessTokenOptions, VideoGrant } from 'livekit-server-sdk';
import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserId } from '@/lib/supabase/server/request-user';
import {
  consumeBudget,
  consumeWindowedLimit,
  isCostCircuitBreakerEnabled,
} from '@/lib/server/traffic-guards';

export const runtime = 'nodejs';
export const revalidate = 0;

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const signatureSkewMs = Math.max(30_000, Number(process.env.TOKEN_SIGNATURE_MAX_SKEW_MS ?? 300_000));
const userRatePerMinute = Math.max(1, Number(process.env.TOKEN_RATE_LIMIT_PER_USER_PER_MIN ?? 30));
const roomRatePerMinute = Math.max(1, Number(process.env.TOKEN_RATE_LIMIT_PER_ROOM_PER_MIN ?? 90));
const nonceTtlMs = Math.max(60_000, Number(process.env.TOKEN_NONCE_TTL_MS ?? 120_000));
const tokenBudgetPerMinute = Math.max(1, Number(process.env.COST_TOKEN_MINT_PER_MINUTE_LIMIT ?? 300));
const REQUIRE_AUTH =
  (process.env.TOKEN_REQUIRE_AUTH ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) ===
  'true';
const REQUIRE_SIGNED_NONCE =
  (process.env.TOKEN_REQUIRE_SIGNED_NONCE ??
    (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';

const nonceLedger = new Map<string, number>();

const createToken = async (userInfo: AccessTokenOptions, grant: VideoGrant) => {
  if (!apiKey) {
    throw new Error('Server misconfigured: missing LIVEKIT_API_KEY');
  }
  if (!apiSecret) {
    throw new Error('Server misconfigured: missing LIVEKIT_API_SECRET');
  }

  const at = new AccessToken(apiKey, apiSecret, userInfo);
  at.addGrant(grant);
  return await at.toJwt();
};

const readBearerToken = (req: NextRequest): string | null => {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const getTestUserId = (): string | null => {
  if (process.env.NODE_ENV !== 'test') return null;
  const raw = process.env.TEST_USER_ID?.trim();
  return raw || null;
};

const resolveUserId = async (req: NextRequest) => {
  const testUser = getTestUserId();
  if (testUser) return { ok: true as const, userId: testUser };
  return getRequestUserId(req);
};

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

function pruneNonceLedger(now: number) {
  if (nonceLedger.size < 1_000) return;
  for (const [key, ts] of nonceLedger) {
    if (now - ts > nonceTtlMs) {
      nonceLedger.delete(key);
    }
  }
}

function buildSignaturePayload(
  req: NextRequest,
  roomName: string,
  identity: string,
  timestamp: string,
  nonce: string,
) {
  return [
    req.method.toUpperCase(),
    req.nextUrl.pathname,
    roomName,
    identity,
    timestamp,
    nonce,
  ].join('.');
}

function computeSignature(payload: string, bearerToken: string): string {
  return createHash('sha256').update(`${bearerToken}.${payload}`).digest('hex');
}

export async function GET(req: NextRequest) {
  try {
    const roomName =
      req.nextUrl.searchParams.get('roomName') || req.nextUrl.searchParams.get('room');
    const identity =
      req.nextUrl.searchParams.get('identity') || req.nextUrl.searchParams.get('username');
    const name = req.nextUrl.searchParams.get('name');
    const metadata = req.nextUrl.searchParams.get('metadata');

    if (!roomName) {
      return NextResponse.json(
        { error: 'Missing "roomName" or "room" query parameter' },
        { status: 400 },
      );
    }

    if (!identity) {
      return NextResponse.json(
        { error: 'Missing "identity" or "username" query parameter' },
        { status: 400 },
      );
    }

    const wsUrl = process.env.LIVEKIT_URL;
    if (!wsUrl) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing LIVEKIT_URL environment variable' },
        { status: 500 },
      );
    }

    const auth = REQUIRE_AUTH
      ? await resolveUserId(req)
      : ({ ok: true, userId: getTestUserId() || 'anonymous-dev' } as const);
    if (!auth.ok) {
      if (auth.error === 'misconfigured') {
        return NextResponse.json({ error: 'Auth configuration missing' }, { status: 500 });
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bearerToken = readBearerToken(req);
    if (REQUIRE_AUTH && !bearerToken && process.env.NODE_ENV !== 'test') {
      return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
    }
    if (REQUIRE_SIGNED_NONCE && !bearerToken && process.env.NODE_ENV !== 'test') {
      return NextResponse.json({ error: 'Missing bearer token for signed request' }, { status: 401 });
    }

    const timestamp = req.headers.get('x-timestamp')?.trim() || '';
    const signature = req.headers.get('x-signature')?.trim() || '';
    const nonce = req.headers.get('x-nonce')?.trim() || '';
    if (REQUIRE_SIGNED_NONCE && (!timestamp || !signature || !nonce) && process.env.NODE_ENV !== 'test') {
      return NextResponse.json(
        { error: 'Missing required signed nonce headers: x-timestamp, x-signature, x-nonce' },
        { status: 401 },
      );
    }

    if (REQUIRE_SIGNED_NONCE && timestamp && signature && nonce && bearerToken) {
      const now = Date.now();
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(now - ts) > signatureSkewMs) {
        return NextResponse.json({ error: 'Signature timestamp expired' }, { status: 401 });
      }

      pruneNonceLedger(now);
      const nonceKey = `${auth.userId}:${nonce}`;
      const usedAt = nonceLedger.get(nonceKey);
      if (typeof usedAt === 'number' && now - usedAt < nonceTtlMs) {
        return NextResponse.json({ error: 'Nonce already used' }, { status: 409 });
      }

      const payload = buildSignaturePayload(req, roomName.trim(), identity.trim(), timestamp, nonce);
      const expected = computeSignature(payload, bearerToken);
      if (!safeEqual(expected, signature)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      nonceLedger.set(nonceKey, now);
    }

    const userRate = consumeWindowedLimit(
      `token:user:${auth.userId}`,
      userRatePerMinute,
      60_000,
    );
    if (!userRate.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfterSec: userRate.retryAfterSec },
        {
          status: 429,
          headers: { 'Retry-After': String(userRate.retryAfterSec) },
        },
      );
    }

    const roomRate = consumeWindowedLimit(`token:room:${roomName.trim()}`, roomRatePerMinute, 60_000);
    if (!roomRate.ok) {
      return NextResponse.json(
        { error: 'Room rate limit exceeded', retryAfterSec: roomRate.retryAfterSec },
        {
          status: 429,
          headers: { 'Retry-After': String(roomRate.retryAfterSec) },
        },
      );
    }

    if (isCostCircuitBreakerEnabled()) {
      const budget = consumeBudget('token-mints', 1, tokenBudgetPerMinute, 60_000);
      if (!budget.ok) {
        return NextResponse.json(
          { error: 'Token budget exceeded', retryAfterSec: budget.retryAfterSec },
          {
            status: 429,
            headers: { 'Retry-After': String(budget.retryAfterSec) },
          },
        );
      }
    }

    const grant: VideoGrant = {
      room: roomName.trim(),
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canUpdateOwnMetadata: true,
    };

    const token = await createToken(
      {
        identity: identity.trim(),
        name: name || undefined,
        metadata: metadata || undefined,
      },
      grant,
    );

    return NextResponse.json(
      { identity: identity.trim(), accessToken: token },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[token] generation error', e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Failed to create token',
        stack: process.env.NODE_ENV === 'development' ? (e as Error).stack : undefined,
      },
      { status: 500 },
    );
  }
}
