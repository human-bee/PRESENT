'use client';

// Force dynamic rendering to prevent build errors
export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signInWithGoogle, signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Handle OAuth errors from URL params
  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError === 'oauth_error') {
      setError('There was an issue with OAuth authentication. Please try again.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await signInWithEmail(email, password);
      router.push('/canvas');
    } catch (error: any) {
      setError(error.message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    try {
      await signInWithGoogle();
      // The redirect will be handled by the OAuth flow
    } catch (error: any) {
      setError(error.message || 'Failed to sign in with Google');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="bg-surface-elevated border border-default p-8 rounded-2xl shadow-lg w-full max-w-md">
        <h1 className="heading-lg text-center mb-6">Sign In</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-secondary">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 border border-default rounded-lg bg-surface shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-secondary">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 border border-default rounded-lg bg-surface shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            />
          </div>

          {error && (
            <div className="text-danger text-sm text-center bg-danger-surface p-3 rounded-lg border border-danger-outline">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 rounded-lg shadow-sm text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-default" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-surface-elevated text-secondary">Or continue with</span>
            </div>
          </div>

          <button
            onClick={handleGoogleSignIn}
            className="mt-3 w-full flex justify-center items-center py-2 px-4 border border-default rounded-lg shadow-sm text-sm font-medium text-primary bg-surface hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>
        </div>

        <p className="mt-4 text-center text-sm text-secondary">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="font-medium hover:text-[var(--present-accent)]">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignIn() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface p-6">
          <div className="bg-surface-elevated border border-default p-8 rounded-2xl shadow-lg w-full max-w-md">
            <div className="animate-pulse">
              <div className="h-8 bg-surface-secondary rounded mb-6"></div>
              <div className="space-y-4">
                <div className="h-10 bg-surface-secondary rounded"></div>
                <div className="h-10 bg-surface-secondary rounded"></div>
                <div className="h-10 bg-surface-secondary rounded"></div>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
