"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthFinish() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;

    const finish = async () => {
      try {
        const next = searchParams.get("next") || "/canvas";

        // 1) Try Authorization Code flow (?code=)
        const code = searchParams.get("code");
        if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
          router.replace(next);
          return;
        }

        // 2) Handle implicit flow (#access_token=...)
        if (typeof window !== "undefined" && window.location.hash) {
          const hash = window.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token") || params.get("provider_refresh_token");

          if (access_token && refresh_token) {
            const { error: setErr } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (setErr) throw setErr;
            // Clean the hash from the URL
            try {
              const url = new URL(window.location.href);
              url.hash = "";
              window.history.replaceState({}, "", url.toString());
            } catch {}
            router.replace(next);
            return;
          }
        }

        // 3) If neither code nor tokens are present, show a friendly error
        setError("Missing OAuth credentials in URL. Please try signing in again.");
      } catch (e: any) {
        setError(e?.message || "Authentication error. Please try again.");
      } finally {
        done = true;
      }
    };

    if (!done) void finish();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md text-center">
        {!error ? (
          <>
            <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mb-3" />
            <div className="text-gray-700">Finishing sign-in…</div>
          </>
        ) : (
          <>
            <div className="text-red-600 font-medium mb-2">Authentication Error</div>
            <div className="text-sm text-gray-600 mb-4">{error}</div>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              onClick={() => router.replace("/auth/signin")}
            >
              Return to Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );
}


