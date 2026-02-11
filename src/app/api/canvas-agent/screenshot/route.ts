import { NextRequest, NextResponse } from 'next/server';
import { storeScreenshot } from '@/server/inboxes/screenshot';
import { verifyAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';
import { consumeBudget, isCostCircuitBreakerEnabled } from '@/lib/server/traffic-guards';

const REQUIRE_AGENT_TOKEN = process.env.CANVAS_AGENT_REQUIRE_TOKEN === 'true';
const SCREENSHOT_BUDGET_BYTES_PER_MIN = Math.max(
  200_000,
  Number(process.env.COST_SCREENSHOT_BYTES_PER_MINUTE_LIMIT ?? 8_000_000),
);

function estimateDataUrlBytes(dataUrl: unknown): number {
  if (typeof dataUrl !== 'string' || !dataUrl) return 0;
  const commaIndex = dataUrl.indexOf(',');
  const base64Payload = (commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl).replace(/\s+/g, '');
  if (!base64Payload) return 0;
  const padding = base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64Payload.length * 3) / 4) - padding);
}

export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > 400_000) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    const body = await req.json();
    const sessionId = String(body?.sessionId || '').trim();
    const requestId = String(body?.requestId || '').trim();
    const roomId = String(body?.roomId || '').trim();
    const token = typeof body?.token === 'string' ? body.token : undefined;
    const key = `${sessionId}::${requestId}`;
    if (!key || key === '::') {
      return NextResponse.json({ error: 'Invalid screenshot payload' }, { status: 400 });
    }
    if (REQUIRE_AGENT_TOKEN && !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (token && !verifyAgentToken(token, { sessionId, roomId, requestId })) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const claimedImageBytes =
      typeof body?.image?.bytes === 'number' && Number.isFinite(body.image.bytes)
        ? Math.max(0, Math.floor(body.image.bytes))
        : 0;
    const derivedImageBytes = estimateDataUrlBytes(body?.image?.dataUrl);
    const imageBytes = Math.max(claimedImageBytes, derivedImageBytes);
    if (isCostCircuitBreakerEnabled()) {
      const metricKey = roomId ? `screenshot-bytes:room:${roomId}` : `screenshot-bytes:session:${sessionId}`;
      const budget = consumeBudget(metricKey, imageBytes, SCREENSHOT_BUDGET_BYTES_PER_MIN, 60_000);
      if (!budget.ok) {
        return NextResponse.json(
          { error: 'Screenshot budget exceeded', retryAfterSec: budget.retryAfterSec },
          { status: 429, headers: { 'Retry-After': String(budget.retryAfterSec) } },
        );
      }
    }
    if (body?.image && typeof body.image === 'object') {
      body.image.bytes = imageBytes;
    }
    storeScreenshot(body as any);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
