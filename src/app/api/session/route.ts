import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roomName = searchParams.get('roomName');
  const canvasId = searchParams.get('canvasId');

  if (!roomName) {
    return NextResponse.json({ error: 'Missing roomName' }, { status: 400 });
  }

  try {
    let query = supabase.from('canvas_sessions').select('*').eq('room_name', roomName);
    if (canvasId === null || canvasId === 'null' || canvasId === '') {
      // @ts-ignore
      query = (query as any).is('canvas_id', null);
    } else if (canvasId) {
      query = query.eq('canvas_id', canvasId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ session: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
