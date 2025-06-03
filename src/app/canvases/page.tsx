"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Calendar, Trash2, ExternalLink, MessageSquare } from "lucide-react";
import { toast } from "react-hot-toast";
import { useAuth } from "@/hooks/use-auth";
import { supabase, type Canvas } from "@/lib/supabase";

export default function CanvasesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Redirect to sign in if not authenticated
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/auth/signin");
    }
  }, [user, loading, router]);

  // Fetch user's canvases
  useEffect(() => {
    const fetchCanvases = async () => {
      if (!user) return;
      
      try {
        const { data: canvases, error } = await supabase
          .from('canvases')
          .select('*')
          .eq('user_id', user.id)
          .order('last_modified', { ascending: false });

        if (error) throw error;
        setCanvases(canvases || []);
      } catch (error) {
        console.error("Error fetching canvases:", error);
        toast.error("Failed to load canvases");
      } finally {
        setIsLoading(false);
      }
    };

    fetchCanvases();
  }, [user]);

  const handleDelete = async (canvasId: string) => {
    if (!confirm("Are you sure you want to delete this canvas?")) return;

    try {
      const { error } = await supabase
        .from('canvases')
        .delete()
        .eq('id', canvasId)
        .eq('user_id', user?.id);

      if (error) throw error;

      setCanvases(canvases.filter(c => c.id !== canvasId));
      toast.success("Canvas deleted");
    } catch (error) {
      console.error("Error deleting canvas:", error);
      toast.error("Failed to delete canvas");
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Canvases</h1>
            <p className="mt-2 text-gray-600">
              Welcome back, {user.user_metadata?.full_name || user.email}
            </p>
          </div>
          
          <Link
            href="/canvas"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Canvas
          </Link>
        </div>

        {/* Canvas Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading canvases...</div>
          </div>
        ) : canvases.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎨</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              No canvases yet
            </h3>
            <p className="text-gray-500 mb-6">
              Create your first canvas to get started
            </p>
            <Link
              href="/canvas"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Create Canvas
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {canvases.map((canvas) => (
              <div
                key={canvas.id}
                className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden"
              >
                {/* Canvas Thumbnail or Placeholder */}
                <div className="h-48 bg-gradient-to-br from-blue-100 to-indigo-100 relative">
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
                    <div className="absolute top-2 right-2 bg-white/90 rounded-full p-1.5" title="Has linked conversation">
                      <MessageSquare className="w-4 h-4 text-blue-600" />
                    </div>
                  )}
                </div>

                {/* Canvas Info */}
                <div className="p-4">
                  <h3 className="font-semibold text-lg text-gray-900 mb-1">
                    {canvas.name}
                  </h3>
                  {canvas.description && (
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                      {canvas.description}
                    </p>
                  )}
                  
                  {/* Last Modified */}
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
                    <Calendar className="w-3 h-3" />
                    <span>
                      Last modified: {new Date(canvas.last_modified).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-between items-center">
                    <Link
                      href={`/canvas?id=${canvas.id}`}
                      className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      Open
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                    
                    <button
                      onClick={() => handleDelete(canvas.id)}
                      className="text-sm text-red-600 hover:text-red-700"
                      title="Delete canvas"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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