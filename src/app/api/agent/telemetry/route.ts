import { NextRequest, NextResponse } from 'next/server';
import {
  flushReplayTelemetryNow,
  recordExternalTelemetryEvent,
} from '@/lib/agents/shared/replay-telemetry';
import { resolveRequestUser } from '@/lib/supabase/server/resolve-request-user';

export const runtime = 'nodejs';

const normalizeOptional = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readBearer = (req: NextRequest): string | undefined => {
  const authHeader = normalizeOptional(req.headers.get('authorization'));
  if (!authHeader) return undefined;
  const raw = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  return normalizeOptional(raw);
};

const isAuthorized = async (req: NextRequest): Promise<boolean> => {
  const token = normalizeOptional(process.env.AGENT_TELEMETRY_INGEST_TOKEN);
  const bearer = readBearer(req);
  if (token) {
    // Hard requirement: when ingest token is configured, require bearer-token auth.
    return bearer === token;
  }

  const user = await resolveRequestUser(req);
  if (user?.id) return true;

  return process.env.NODE_ENV !== 'production';
};

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const payload =
      body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : undefined;
    const readField = (key: string) =>
      normalizeOptional(body?.[key]) ?? normalizeOptional(payload?.[key]);
    const event = normalizeOptional(body?.event) ?? 'unknown';
    const metadata =
      (body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? (payload.metadata as Record<string, unknown>)
          : undefined);

    const accepted = recordExternalTelemetryEvent({
      event,
      payload: body?.payload,
      metadata,
      status: readField('status'),
      room: readField('room'),
      sessionId: readField('sessionId'),
      traceId: readField('traceId'),
      requestId: readField('requestId'),
      intentId: readField('intentId'),
    });

    if (!accepted) {
      return NextResponse.json({ status: 'dropped' }, { status: 202 });
    }

    const flushed = await flushReplayTelemetryNow();
    if (!flushed) {
      return NextResponse.json({ status: 'queued' }, { status: 202 });
    }
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
