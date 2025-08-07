import { useEffect, useRef, useState, useCallback } from "react";
import { Editor } from "tldraw";
import { useRouter } from "next/navigation";
import { useTamboThread } from "@tambo-ai/react";
import { toast } from "react-hot-toast";
import { supabase, type Canvas } from "@/lib/supabase";
import { useAuth } from "./use-auth";

export function useCanvasPersistence(editor: Editor | null, enabled: boolean = true) {
  const { user } = useAuth();
  const router = useRouter();
  const { thread } = useTamboThread();
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [canvasName, setCanvasName] = useState("Untitled Canvas");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load canvas from URL param or create new
  useEffect(() => {
    const loadCanvas = async () => {
      if (!user?.id || !editor) return;

      // Check URL params for canvas ID
      const urlParams = new URLSearchParams(window.location.search);
      const canvasIdParam = urlParams.get("id");

      if (canvasIdParam) {
        // Load existing canvas
        try {
          const { data: canvas, error } = await supabase
            .from('canvases')
            .select('*')
            .eq('id', canvasIdParam)
            .eq('user_id', user.id)
            .single();

          if (error) throw error;

          if (canvas) {
            console.log('🎨 [CanvasPersistence] Loading canvas:', canvas.id, canvas.name);
            console.log('🎨 [CanvasPersistence] Canvas document has shapes:', Object.keys(canvas.document?.store?.['shape:tambo'] || {}));
            console.log('🎨 [CanvasPersistence] Conversation key:', canvas.conversation_key);
            
            setCanvasId(canvas.id);
            setCanvasName(canvas.name);
            setLastSaved(new Date(canvas.last_modified));
            
            // Load the document into the editor
            editor.loadSnapshot(canvas.document);
            
            console.log('🎨 [CanvasPersistence] Canvas loaded successfully - shapes should appear');
            
            // CRITICAL: Rehydrate component store after canvas loads
            // The canvas document contains shapes, but componentStore is empty on reload
            setTimeout(() => {
              console.log('🔄 [CanvasPersistence] Starting component rehydration...');
              window.dispatchEvent(new CustomEvent('tambo:rehydrateComponents', {
                detail: { canvasId: canvas.id, conversationKey: canvas.conversation_key }
              }));
            }, 100); // Small delay to ensure editor is fully loaded
          }
        } catch (error) {
          console.error("Error loading canvas:", error);
          toast.error("Canvas not found");
          router.push("/canvas");
        }
      }
    };

    loadCanvas();
  }, [user, editor, router]);

  // Auto-save functionality
  const saveCanvas = useCallback(async () => {
    if (!enabled) return;
    if (!editor || !user?.id || isSaving) return;

    setIsSaving(true);
    try {
      const snapshot = editor.getSnapshot();
      const conversationKey = thread?.id || null;
      const now = new Date().toISOString();

      if (canvasId) {
        // Update existing canvas
        const { error } = await supabase
          .from('canvases')
          .update({
            document: snapshot,
            conversation_key: conversationKey,
            last_modified: now,
            updated_at: now,
          })
          .eq('id', canvasId)
          .eq('user_id', user.id);

        if (error) throw error;
        setLastSaved(new Date());
      } else {
        // Create new canvas
        const { data: newCanvas, error } = await supabase
          .from('canvases')
          .insert({
            user_id: user.id,
            name: canvasName,
            document: snapshot,
            conversation_key: conversationKey,
            is_public: false,
            last_modified: now,
          })
          .select()
          .single();

        if (error) throw error;

        setCanvasId(newCanvas.id);
        setLastSaved(new Date());
        
        // Update URL with canvas ID
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("id", newCanvas.id);
        window.history.replaceState({}, "", newUrl.toString());
      }
    } catch (error) {
      console.error("Error saving canvas:", error);
      toast.error("Failed to save canvas");
    } finally {
      setIsSaving(false);
    }
  }, [editor, user, canvasId, canvasName, thread, isSaving, enabled]);

  // Set up auto-save on editor changes
  useEffect(() => {
    if (!editor) return;
    if (!enabled) return;

    const handleChange = () => {
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout for auto-save (3 seconds after last change)
      saveTimeoutRef.current = setTimeout(() => {
        saveCanvas();
      }, 3000);
    };

    // Listen to editor changes
    const unsubscribe = editor.store.listen(handleChange, { scope: "document" });

    return () => {
      unsubscribe();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editor, saveCanvas, enabled]);

  // Manual save function
  const manualSave = useCallback(async () => {
    if (!enabled) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    await saveCanvas();
    toast.success("Canvas saved!");
  }, [saveCanvas, enabled]);

  // Update canvas name
  const updateCanvasName = useCallback(async (newName: string) => {
    setCanvasName(newName);
    
    if (canvasId && user?.id) {
      try {
        const { error } = await supabase
          .from('canvases')
          .update({ name: newName })
          .eq('id', canvasId)
          .eq('user_id', user.id);

        if (error) throw error;
      } catch (error) {
        console.error("Error updating canvas name:", error);
      }
    }
  }, [canvasId, user]);

  return {
    canvasId,
    canvasName,
    isSaving,
    lastSaved,
    saveCanvas: manualSave,
    updateCanvasName,
  };
} 