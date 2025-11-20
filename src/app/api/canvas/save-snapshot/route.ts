import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { canvasId, snapshot, thumbnail, conversationKey, name } = (await request.json().catch(() => ({}))) as {
      canvasId?: string;
      snapshot?: any;
      thumbnail?: string | null;
      conversationKey?: string | null;
      name?: string | null;
    };

    if (!canvasId || typeof canvasId !== 'string') {
      return NextResponse.json({ error: 'canvasId required' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Supabase service key missing' }, { status: 500 });
    }

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = new Date().toISOString();
    if (process.env.NODE_ENV !== 'production') {
      console.log('[save-snapshot] update', {
        canvasId,
        hasSnapshot: snapshot ? true : false,
        storeKeys: snapshot?.store ? Object.keys(snapshot.store).length : 0,
      });
    }
    const { error } = await supabase
      .from('canvases')
      .update({
        name: name || canvasId,
        document: snapshot ?? {},
        conversation_key: conversationKey ?? null,
        last_modified: now,
        updated_at: now,
        thumbnail: thumbnail ?? null,
      })
      .eq('id', canvasId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'unexpected error' }, { status: 500 });
  }
}
