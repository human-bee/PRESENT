/**
 * CanvasesPage
 *
 * This page displays a list of canvases belonging to the authenticated user.
 * It handles authentication checks, fetches the user's canvases from Supabase,
 * and provides UI for viewing, creating, and managing canvases.
 *
 * Redirects to the sign-in page if the user is not authenticated.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Calendar, Trash2, ExternalLink, MessageSquare } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/hooks/use-auth';
import { supabase, type Canvas } from '@/lib/supabase';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { getBooleanFlag } from '@/lib/feature-flags';

type UserCanvas = Canvas & { owner_id: string; membership_role: 'owner' | 'editor' | 'viewer' };

export default function CanvasesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [canvases, setCanvases] = useState<UserCanvas[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);

  const demoMode = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);
  const bypassAuth = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS, false);
  const byokEnabled = !demoMode && !bypassAuth;

  // Redirect to sign in if not authenticated
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/auth/signin');
    }
  }, [user, loading, router]);

  // Fetch user's canvases
  useEffect(() => {
    const fetchCanvases = async () => {
      if (!user) return;

      try {
        // Prefer unified view of owned + shared canvases
        const { data: canvases, error } = await supabase
          .from('user_canvases')
          .select('*')
          .order('last_modified', { ascending: false });

        if (error) throw error;
        const list = (canvases || []) as UserCanvas[];
        // Dedupe by id to avoid duplicate React keys from the view
        const seen = new Set<string>();
        const deduped = list.filter((c) => {
          if (!c?.id) return false;
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
        setCanvases(deduped);
      } catch (error) {
        console.error('Error fetching canvases:', error);
        toast.error('Failed to load canvases');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCanvases();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!byokEnabled) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithSupabaseAuth('/api/model-keys');
        if (!res.ok) {
          // In demo/bypass this endpoint returns 404; ignore.
          return;
        }
        const json = await res.json();
        const keys = Array.isArray(json?.keys) ? json.keys : [];
        const openai = keys.find((k: any) => k?.provider === 'openai');
        if (!cancelled) setOpenaiConfigured(Boolean(openai?.configured));
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, byokEnabled]);

  const handleDelete = async (canvasId: string) => {
    if (!confirm('Are you sure you want to delete this canvas?')) return;

    try {
      const { error } = await supabase
        .from('canvases')
        .delete()
        .eq('id', canvasId)
        .eq('user_id', user?.id);

      if (error) throw error;

      setCanvases(canvases.filter((c) => c.id !== canvasId));
      toast.success('Canvas deleted');
    } catch (error) {
      console.error('Error deleting canvas:', error);
      toast.error('Failed to delete canvas');
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-secondary text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {byokEnabled && openaiConfigured === false && (
          <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-yellow-900">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold">OpenAI key missing.</span> Add your model keys to enable voice and stewards.
              </div>
              <Link
                href="/settings/keys"
                className="shrink-0 rounded bg-yellow-900 px-3 py-1.5 text-sm text-yellow-50 hover:bg-yellow-950"
              >
                Manage keys
              </Link>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="heading-lg">My canvases</h1>
            <p className="mt-2 text-secondary text-sm">
              Welcome back, {user.user_metadata?.full_name || user.email}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {byokEnabled && (
              <Link
                href="/settings/keys"
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 transition-colors"
              >
                Model Keys
              </Link>
            )}

            <button
              onClick={() => {
                try {
                  localStorage.removeItem('present:lastCanvasId');
                } catch {}
                router.push('/canvas');
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              New Canvas
            </button>
          </div>
        </div>

        {/* Canvas Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-secondary text-sm">Loading canvases…</div>
          </div>
        ) : canvases.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎨</div>
            <h3 className="heading-md mb-2">No canvases yet</h3>
            <p className="text-secondary mb-6 text-sm">Create your first canvas to get started</p>
            <Button
              onClick={() => {
                try {
                  localStorage.removeItem('present:lastCanvasId');
                } catch {}
                router.push('/canvas');
              }}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create Canvas
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {canvases.map((canvas) => (
              <div
                key={canvas.id}
                className="bg-surface-elevated border border-default rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden"
              >
                {/* Canvas Thumbnail or Placeholder */}
                <div className="h-48 bg-surface-secondary relative">
                  {canvas.thumbnail ? (
                    <img
                      src={canvas.thumbnail}
                      alt={canvas.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-6xl opacity-20">🎨</div>
                    </div>
                  )}

                  {/* Conversation Indicator */}
                  {canvas.conversation_key && (
                    <div
                      className="absolute top-2 right-2 bg-surface/90 rounded-full p-1.5 border border-default"
                      title="Has linked conversation"
                    >
                      <MessageSquare className="w-4 h-4 text-secondary" />
                    </div>
                  )}
                </div>

                {/* Canvas Info */}
                <div className="p-4">
                  <h3 className="font-semibold text-lg text-primary mb-1">{canvas.name}</h3>
                  <div className="text-xs text-tertiary mb-2">
                    {canvas.membership_role === 'owner'
                      ? 'Owned by you'
                      : `Shared · ${canvas.membership_role}`}
                  </div>
                  {canvas.description && (
                    <p className="text-sm text-secondary mb-3 line-clamp-2">{canvas.description}</p>
                  )}

                  {/* Last Modified */}
                  <div className="flex items-center gap-1 text-xs text-tertiary mb-3">
                    <Calendar className="w-3 h-3" />
                    <span>
                      Last modified: {new Date(canvas.last_modified).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-between items-center">
                    <Link
                      href={`/canvas?id=${canvas.id}`}
                      className="flex items-center gap-1 text-sm font-medium hover:text-[var(--present-accent)]"
                    >
                      Open
                      <ExternalLink className="w-3 h-3" />
                    </Link>

                    {canvas.membership_role === 'owner' && (
                      <button
                        onClick={() => handleDelete(canvas.id)}
                        className="text-sm text-danger hover:opacity-80"
                        title="Delete canvas"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
