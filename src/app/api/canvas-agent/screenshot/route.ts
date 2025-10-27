import { NextRequest, NextResponse } from 'next/server';
import { storeScreenshot } from '@/server/inboxes/screenshot';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const key = `${String(body?.sessionId || '').trim()}::${String(body?.requestId || '').trim()}`;
    if (!key || key === '::') {
      return NextResponse.json({ error: 'Invalid screenshot payload' }, { status: 400 });
    }
    storeScreenshot(body as any);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

