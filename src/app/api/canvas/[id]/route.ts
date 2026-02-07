import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// GET /api/canvas/[id] - Get a specific canvas
export async function GET(_request: Request, { params }: { params: { id: string } }) {
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

    const { data: canvas, error } = await supabase
      .from('canvases')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (error || !canvas) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 });
    }

    return NextResponse.json({ canvas });
  } catch (error) {
    console.error('Error fetching canvas:', error);
    return NextResponse.json({ error: 'Failed to fetch canvas' }, { status: 500 });
  }
}

// PUT /api/canvas/[id] - Update a canvas
export async function PUT(request: Request, { params }: { params: { id: string } }) {
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

    const { name, description, document, thumbnail, conversationKey } = await request.json();

    // Check if the canvas belongs to the user
    const { data: existingCanvas } = await supabase
      .from('canvases')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (!existingCanvas) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 });
    }

    const updateData: any = {
      last_modified: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (document !== undefined) updateData.document = document;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    if (conversationKey !== undefined) updateData.conversation_key = conversationKey;

    const { data: updatedCanvas, error } = await supabase
      .from('canvases')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating canvas:', error);
      return NextResponse.json({ error: 'Failed to update canvas' }, { status: 500 });
    }

    return NextResponse.json({ canvas: updatedCanvas });
  } catch (error) {
    console.error('Error updating canvas:', error);
    return NextResponse.json({ error: 'Failed to update canvas' }, { status: 500 });
  }
}

// DELETE /api/canvas/[id] - Delete a canvas
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
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

    // Check if the canvas belongs to the user
    const { data: existingCanvas } = await supabase
      .from('canvases')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (!existingCanvas) {
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 });
    }

    const { error } = await supabase.from('canvases').delete().eq('id', params.id);

    if (error) {
      console.error('Error deleting canvas:', error);
      return NextResponse.json({ error: 'Failed to delete canvas' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Canvas deleted successfully' });
  } catch (error) {
    console.error('Error deleting canvas:', error);
    return NextResponse.json({ error: 'Failed to delete canvas' }, { status: 500 });
  }
}
