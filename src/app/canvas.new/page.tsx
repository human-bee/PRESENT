"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

export default function NewCanvasRedirect() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth/signin?next=/canvas.new");
      return;
    }

    (async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("canvases")
        .insert({
          user_id: user.id,
          name: "Untitled Canvas",
          description: null,
          document: {},
          conversation_key: null,
          is_public: false,
          last_modified: now,
        })
        .select("id")
        .single();

      if (!data?.id || error) {
        router.replace("/canvas");
        return;
      }

      const canvasId = data.id as string;
      try {
        await supabase
          .from("canvases")
          .update({ name: canvasId, updated_at: now, last_modified: now })
          .eq("id", canvasId);
        await supabase
          .from("canvas_members")
          .upsert({ canvas_id: canvasId, user_id: user.id, role: "editor", created_at: now } as any, {
            onConflict: "canvas_id,user_id",
          } as any);
      } catch {}

      router.replace(`/canvas?id=${encodeURIComponent(canvasId)}`);
    })();
  }, [user, loading, router]);

  return (
    <div className="h-screen w-screen flex items-center justify-center">
      <div className="text-gray-500">Creating a new canvas…</div>
    </div>
  );
}


