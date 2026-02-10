'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function AuthFinishContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;

    const finish = async () => {
      try {
        const next = searchParams.get('next') || '/canvas';

        // 1) Try Authorization Code flow (?code=)
        const code = searchParams.get('code');
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
          router.replace(next);
          return;
        }

        // 2) Handle implicit flow (#access_token=...)
        if (typeof window !== 'undefined' && window.location.hash) {
          const hash = window.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token') || params.get('provider_refresh_token');

          if (access_token && refresh_token) {
            const { error: setErr } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (setErr) throw setErr;
            // Clean the hash from the URL
            try {
              const url = new URL(window.location.href);
              url.hash = '';
              window.history.replaceState({}, '', url.toString());
            } catch {}
            router.replace(next);
            return;
          }
        }

        // 3) If neither code nor tokens are present, show a friendly error
        setError('Missing OAuth credentials in URL. Please try signing in again.');
      } catch (e: any) {
        setError(e?.message || 'Authentication error. Please try again.');
      } finally {
        done = true;
      }
    };

    if (!done) void finish();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="bg-surface-elevated border border-default p-8 rounded-2xl shadow-lg w-full max-w-md text-center">
        {!error ? (
          <>
            <div className="animate-spin inline-block w-6 h-6 border-2 border-[var(--present-accent)] border-t-transparent rounded-full mb-3" />
            <div className="text-secondary text-sm">Finishing sign-in…</div>
          </>
        ) : (
          <>
            <div className="text-danger font-medium mb-2">Authentication Error</div>
            <div className="text-sm text-secondary mb-4">{error}</div>
            <button
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              onClick={() => router.replace('/auth/signin')}
            >
              Return to Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthFinish() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface p-6">
          <div className="bg-surface-elevated border border-default p-8 rounded-2xl shadow-lg w-full max-w-md text-center">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-[var(--present-accent)] border-t-transparent rounded-full mb-3" />
            <div className="text-secondary text-sm">Loading…</div>
          </div>
        </div>
      }
    >
      <AuthFinishContent />
    </Suspense>
  );
}
