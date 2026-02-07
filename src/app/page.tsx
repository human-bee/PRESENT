/**
 * Home page component for the Next.js application.
 *
 * This component serves as the main landing page for the application.
 * It includes:
 * - A logo and title section
 * - A setup checklist section
 * - A how it works section
 * - A footer section
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const next = '/canvas';
    // If Supabase returned implicit tokens in the hash, forward them to /auth/finish
    if (hash.includes('access_token=')) {
      window.location.replace(`/auth/finish?next=${encodeURIComponent(next)}${hash}`);
      return;
    }
    // Otherwise, just go to the canvas
    router.replace(next);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-secondary text-sm">Redirecting…</div>
    </div>
  );
}
