import { createClient } from '@supabase/supabase-js';

const ROOM_ID_REGEX = /^canvas-([a-zA-Z0-9_-]+)$/;

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase configuration for canvas billing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function parseCanvasIdFromRoom(roomName: string): string | null {
  const trimmed = (roomName || '').trim();
  const match = ROOM_ID_REGEX.exec(trimmed);
  return match?.[1] ?? null;
}

export async function getCanvasOwnerUserId(canvasId: string): Promise<string | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('canvases')
    .select('user_id')
    .eq('id', canvasId.trim())
    .maybeSingle();
  if (error) throw new Error(`Canvas lookup failed: ${error.message}`);
  const userId = typeof (data as any)?.user_id === 'string' ? String((data as any).user_id).trim() : '';
  return userId || null;
}

export async function assertCanvasMember(params: {
  canvasId: string;
  requesterUserId: string;
  ownerUserId?: string;
}): Promise<{ ownerUserId: string }> {
  const canvasId = params.canvasId.trim();
  const requesterUserId = params.requesterUserId.trim();
  if (!canvasId) throw new Error('Missing canvasId');
  if (!requesterUserId) throw new Error('Missing requesterUserId');

  const ownerUserId = params.ownerUserId?.trim() || (await getCanvasOwnerUserId(canvasId));
  if (!ownerUserId) throw new Error('Canvas not found');

  if (ownerUserId === requesterUserId) {
    return { ownerUserId };
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('canvas_members')
    .select('canvas_id')
    .eq('canvas_id', canvasId)
    .eq('user_id', requesterUserId)
    .maybeSingle();

  if (error) throw new Error(`Canvas membership lookup failed: ${error.message}`);
  if (!data) {
    const err = new Error('Forbidden');
    (err as Error & { code?: string }).code = 'forbidden';
    throw err;
  }

  return { ownerUserId };
}

export async function resolveBillingUserIdForRoom(roomName: string): Promise<string | null> {
  const canvasId = parseCanvasIdFromRoom(roomName);
  if (!canvasId) return null;
  return await getCanvasOwnerUserId(canvasId);
}

