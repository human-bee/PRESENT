import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_SYNC_RESET_ENDPOINT =
  process.env.TLDRAW_SYNC_RESET_URL ||
  process.env.NEXT_PUBLIC_TLDRAW_SYNC_RESET_URL ||
  'http://127.0.0.1:3100';

export async function POST(req: NextRequest) {
  try {
    const { room } = await req.json();
    if (typeof room !== 'string' || !room.trim()) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    const endpoint = new URL(DEFAULT_SYNC_RESET_ENDPOINT);
    endpoint.pathname = `/admin/reset-room/${encodeURIComponent(room.trim())}`;

    await fetch(endpoint.toString(), {
      method: 'POST',
    });

    return NextResponse.json({ status: 'reset' });
  } catch (error) {
    console.error('[reset-room] failed', error);
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 });
  }
}
