import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getServerClient(authHeader?: string | null) {
  const token = authHeader?.startsWith('Bearer ') ? authHeader : undefined;
  return createClient(url, anon, {
    global: { headers: token ? { Authorization: token } : {} },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roomName = searchParams.get('roomName');
  const canvasId = searchParams.get('canvasId');
  const authHeader = req.headers.get('Authorization');

  if (!roomName) {
    return NextResponse.json({ error: 'Missing roomName' }, { status: 400 });
  }

  const supabase = getServerClient(authHeader);

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

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const supabase = getServerClient(authHeader);
  
  try {
    const payload = await req.json();
    const { data, error } = await supabase
      .from('canvas_sessions')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      // Forward Postgres error codes
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    
    return NextResponse.json({ session: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
