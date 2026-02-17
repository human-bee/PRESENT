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

async function findLatestSession(
  supabase: ReturnType<typeof getServerClient>,
  roomName: string,
  canvasId?: string | null,
) {
  let query = supabase
    .from('canvas_sessions')
    .select('*')
    .eq('room_name', roomName)
    .order('updated_at', { ascending: false });

  if (canvasId !== undefined) {
    if (canvasId === null || canvasId === '') {
      query = (query as any).is('canvas_id', null);
    } else {
      query = query.eq('canvas_id', canvasId);
    }
  }

  return query.limit(1).maybeSingle();
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
    const normalizedCanvasId =
      canvasId === null || canvasId === 'null' || canvasId === '' ? null : canvasId;
    const { data, error } = await findLatestSession(supabase, roomName, normalizedCanvasId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data && normalizedCanvasId) {
      // Self-heal legacy rows where room_name exists but canvas_id stayed null or drifted.
      const { data: byRoom, error: byRoomError } = await findLatestSession(supabase, roomName);
      if (byRoomError) {
        return NextResponse.json({ error: byRoomError.message }, { status: 500 });
      }
      if (byRoom) {
        if (!byRoom.canvas_id) {
          const { data: repaired } = await supabase
            .from('canvas_sessions')
            .update({
              canvas_id: normalizedCanvasId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', byRoom.id)
            .is('canvas_id', null)
            .select('*')
            .maybeSingle();
          return NextResponse.json({ session: repaired ?? byRoom });
        }
        return NextResponse.json({ session: byRoom });
      }
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

    const findExistingSession = async () => findLatestSession(supabase, roomName, canvasId);
    const findExistingByRoom = async () => findLatestSession(supabase, roomName);

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

      if (error?.code === '23505') {
        // Room-level uniqueness race or legacy null-canvas row: return by-room row and repair canvas_id if needed.
        const { data: existingByRoom, error: existingByRoomErr } = await findExistingByRoom();
        if (existingByRoomErr) {
          return NextResponse.json({ error: existingByRoomErr.message }, { status: 500 });
        }
        if (existingByRoom) {
          if (canvasId && !existingByRoom.canvas_id) {
            const { data: repaired } = await supabase
              .from('canvas_sessions')
              .update({
                canvas_id: canvasId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingByRoom.id)
              .is('canvas_id', null)
              .select('*')
              .maybeSingle();
            return NextResponse.json({ session: repaired ?? existingByRoom });
          }
          return NextResponse.json({ session: existingByRoom });
        }
      }
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
