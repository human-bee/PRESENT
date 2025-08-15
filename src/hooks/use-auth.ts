import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    const next = '/canvas'
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Send users to a client-side finisher that supports both code and hash token returns
        redirectTo: `${window.location.origin}/auth/finish?next=${encodeURIComponent(next)}`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      }
    })
    if (error) throw error
  }

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  const signUpWithEmail = async (email: string, password: string, fullName?: string) => {
    const next = '/canvas'
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      }
    })
    if (error) throw error
  }

  const signOut = async () => {
    // Best-effort: clear local session first to avoid missing-session errors
    try {
      await supabase.auth.signOut({ scope: 'local' } as any)
    } catch (_) {
      // ignore
    }

    // If a session exists, attempt a global sign-out to revoke refresh token
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await supabase.auth.signOut()
      }
    } catch (err: any) {
      // Ignore missing-session errors; everything is already cleared locally
      const msg = typeof err?.message === 'string' ? err.message : String(err || '')
      if (!/auth session missing/i.test(msg)) {
        // Log non-trivial errors for debugging but don't throw
        console.warn('[auth] signOut warning:', msg)
      }
    }
  }

  return {
    user,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
  }
} 
