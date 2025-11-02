import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// GET /api/canvas - List user's canvases
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      },
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: canvases, error } = await supabase
      .from('canvases')
      .select(`
        id,
        name,
        description,
        thumbnail,
        conversation_key,
        last_modified,
        created_at
      `)
      .eq('user_id', session.user.id)
      .order('last_modified', { ascending: false });

    if (error) {
      console.error('Error fetching canvases:', error);
      return NextResponse.json({ error: 'Failed to fetch canvases' }, { status: 500 });
    }

    return NextResponse.json({ canvases });
  } catch (error) {
    console.error('Error fetching canvases:', error);
    return NextResponse.json({ error: 'Failed to fetch canvases' }, { status: 500 });
  }
}

// POST /api/canvas - Create a new canvas
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      },
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, description, document, conversationKey } = await request.json();

    if (!name || !document) {
      return NextResponse.json({ error: 'Name and document are required' }, { status: 400 });
    }

    const { data: canvas, error } = await supabase
      .from('canvases')
      .insert({
        user_id: session.user.id,
        name,
        description,
        document,
        conversation_key: conversationKey,
        is_public: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating canvas:', error);
      return NextResponse.json({ error: 'Failed to create canvas' }, { status: 500 });
    }

    return NextResponse.json({ canvas }, { status: 201 });
  } catch (error) {
    console.error('Error creating canvas:', error);
    return NextResponse.json({ error: 'Failed to create canvas' }, { status: 500 });
  }
}
