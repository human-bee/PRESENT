import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event = typeof body?.event === 'string' ? body.event : 'unknown';
    const payload = body?.payload ?? {};
    console.log('[AgentTelemetry]', event, payload);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[AgentTelemetry] error', error);
    return NextResponse.json({ status: 'error' }, { status: 400 });
  }
}
