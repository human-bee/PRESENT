import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const SESSION_CREATE_LOCKS_KEY = '__presentSessionCreateLocks';
const globalLocks = globalThis as typeof globalThis & {
  [SESSION_CREATE_LOCKS_KEY]?: Map<string, Promise<void>>;
};
const sessionCreateLocks =
  globalLocks[SESSION_CREATE_LOCKS_KEY] ?? new Map<string, Promise<void>>();
if (!globalLocks[SESSION_CREATE_LOCKS_KEY]) {
  globalLocks[SESSION_CREATE_LOCKS_KEY] = sessionCreateLocks;
}

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
	    let query = supabase
        .from('canvas_sessions')
        .select('*')
        .eq('room_name', roomName)
        .order('updated_at', { ascending: false });
	    if (canvasId === null || canvasId === 'null' || canvasId === '') {
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
    const roomName = typeof payload?.room_name === 'string' ? payload.room_name.trim() : '';
    const canvasIdRaw = payload?.canvas_id;
    const canvasId =
      typeof canvasIdRaw === 'string' && canvasIdRaw.trim().length > 0 ? canvasIdRaw.trim() : null;

    if (!roomName) {
      return NextResponse.json({ error: 'Missing room_name' }, { status: 400 });
    }

    const findExistingSession = async () => {
      let existingQuery = supabase
        .from('canvas_sessions')
        .select('*')
        .eq('room_name', roomName)
        .order('updated_at', { ascending: false });
      if (canvasId) {
        existingQuery = existingQuery.eq('canvas_id', canvasId);
      } else {
        existingQuery = (existingQuery as any).is('canvas_id', null);
      }
      return existingQuery.limit(1).maybeSingle();
    };

    const lockKey = `${roomName}::${canvasId ?? 'null'}`;
    const inFlight = sessionCreateLocks.get(lockKey);
    if (inFlight) {
      await inFlight.catch(() => {});
      const { data: existingAfterWait, error: existingAfterWaitErr } = await findExistingSession();
      if (existingAfterWaitErr) {
        return NextResponse.json({ error: existingAfterWaitErr.message }, { status: 500 });
      }
      if (existingAfterWait) {
        return NextResponse.json({ session: existingAfterWait });
      }
    }

    let releaseLock: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = () => resolve();
    });
    sessionCreateLocks.set(lockKey, lockPromise);

    let data: any = null;
    let error: { message: string; code?: string | null } | null = null;
    try {
      const { data: existing, error: existingErr } = await findExistingSession();
      if (existingErr) {
        return NextResponse.json({ error: existingErr.message }, { status: 500 });
      }
      if (existing) {
        return NextResponse.json({ session: existing });
      }

      const insert = await supabase
        .from('canvas_sessions')
        .insert({
          ...payload,
          room_name: roomName,
          canvas_id: canvasId,
        })
        .select('*')
        .single();
      data = insert.data;
      error = insert.error;
    } finally {
      releaseLock?.();
      if (sessionCreateLocks.get(lockKey) === lockPromise) {
        sessionCreateLocks.delete(lockKey);
      }
    }

    if (error) {
      // Forward Postgres error codes
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    
    return NextResponse.json({ session: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
