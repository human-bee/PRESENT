import { NextRequest, NextResponse } from 'next/server';
import { recordExternalTelemetryEvent } from '@/lib/agents/shared/replay-telemetry';

export const runtime = 'nodejs';

const normalizeOptional = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isAuthorized = (req: NextRequest): boolean => {
  const token = normalizeOptional(process.env.AGENT_TELEMETRY_INGEST_TOKEN);
  if (!token) {
    return process.env.NODE_ENV !== 'production';
  }
  const authHeader = normalizeOptional(req.headers.get('authorization'));
  if (!authHeader) return false;
  const raw = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  return raw === token;
};

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const event = normalizeOptional(body?.event) ?? 'unknown';
    const payload = body?.payload;
    const metadata =
      body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : undefined;

    recordExternalTelemetryEvent({
      event,
      payload,
      metadata,
      status: normalizeOptional(body?.status),
      room: normalizeOptional(body?.room),
      sessionId: normalizeOptional(body?.sessionId),
      traceId: normalizeOptional(body?.traceId),
      requestId: normalizeOptional(body?.requestId),
      intentId: normalizeOptional(body?.intentId),
    });

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
