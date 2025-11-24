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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = req.headers.get('Authorization');
  const supabase = getServerClient(authHeader);
  const { id } = await params;

  try {
    const payload = await req.json();
    const { error } = await supabase
      .from('canvas_sessions')
      .update(payload)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}

