import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
    }
  )

  const {
    data: { session },
  } = await supabase.auth.getSession()

  // Require auth — if missing, go to sign-in
  if (!session?.user?.id) {
    const signin = new URL('/auth/signin', request.url)
    signin.searchParams.set('next', '/canvas.new')
    return NextResponse.redirect(signin)
  }

  const userId = session.user.id
  const now = new Date().toISOString()

  // Create a blank canvas row
  const { data: created, error } = await supabase
    .from('canvases')
    .insert({
      user_id: userId,
      name: 'Untitled Canvas',
      description: null,
      document: {},
      conversation_key: null,
      is_public: false,
      last_modified: now,
    })
    .select('id')
    .single()

  if (error || !created?.id) {
    // Fallback to /canvas and let client create
    return NextResponse.redirect(new URL('/canvas', request.url))
  }

  const canvasId = created.id as string

  // Make the id the visible name and ensure membership exists
  try {
    await supabase.from('canvases').update({ name: canvasId, updated_at: now, last_modified: now }).eq('id', canvasId)
    await supabase
      .from('canvas_members')
      .upsert({ canvas_id: canvasId, user_id: userId, role: 'editor', created_at: now } as any, {
        onConflict: 'canvas_id,user_id',
      } as any)
  } catch {
    // non-fatal
  }

  // Redirect to the new canvas — this sets LiveKit room and TLDraw store context
  const target = new URL('/canvas', request.url)
  target.searchParams.set('id', canvasId)
  return NextResponse.redirect(target)
}


