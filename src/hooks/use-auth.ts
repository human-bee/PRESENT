import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { DEFAULT_POST_AUTH_PATH, sanitizeInternalRedirectPath } from '@/lib/auth/redirects';

const AUTH_SESSION_TIMEOUT_MS = 3500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Timed out while checking auth session'));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // Get initial session
    withTimeout(supabase.auth.getSession(), AUTH_SESSION_TIMEOUT_MS)
      .then(({ data: { session } }) => {
        if (!active) return;
        setUser(session?.user ?? null);
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[auth] Initial session check failed:', error instanceof Error ? error.message : error);
        setUser(null);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async (next: string = DEFAULT_POST_AUTH_PATH) => {
    const safeNext = sanitizeInternalRedirectPath(next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Send users to a client-side finisher that supports both code and hash token returns
        redirectTo: `${window.location.origin}/auth/finish?next=${encodeURIComponent(safeNext)}`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error) throw error;
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    fullName?: string,
    next: string = DEFAULT_POST_AUTH_PATH,
  ) => {
    const safeNext = sanitizeInternalRedirectPath(next);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    // Best-effort: clear local session first to avoid missing-session errors
    try {
      await supabase.auth.signOut({ scope: 'local' } as any);
    } catch (_) {
      // ignore
    }

    // If a session exists, attempt a global sign-out to revoke refresh token
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        await supabase.auth.signOut();
      }
    } catch (err: any) {
      // Ignore missing-session errors; everything is already cleared locally
      const msg = typeof err?.message === 'string' ? err.message : String(err || '');
      if (!/auth session missing/i.test(msg)) {
        // Log non-trivial errors for debugging but don't throw
        console.warn('[auth] signOut warning:', msg);
      }
    }
  };

  return {
    user,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
  };
}
