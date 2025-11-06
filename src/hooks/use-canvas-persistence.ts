import { useEffect, useRef, useState, useCallback } from 'react';
import { Editor } from 'tldraw';
import { useRouter } from 'next/navigation';
import { usecustomThread } from '@custom-ai/react';
import { toast } from 'react-hot-toast';
import { supabase, type Canvas } from '@/lib/supabase';
import { createLogger } from '@/lib/utils';
import { useAuth } from './use-auth';

export function useCanvasPersistence(editor: Editor | null, enabled: boolean = true) {
  const { user } = useAuth();
  const router = useRouter();
  const { thread } = usecustomThread();
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [canvasName, setCanvasName] = useState('Untitled Canvas');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const logger = createLogger('CanvasPersistence');

  // Load canvas from URL param or create new
  useEffect(() => {
    const loadCanvas = async () => {
      if (!user?.id || !editor) return;

      // Check URL params for canvas ID
      const urlParams = new URLSearchParams(window.location.search);
      const canvasIdParam = urlParams.get('id');
      const isUuid =
        !!canvasIdParam &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canvasIdParam);

      // Optimistically reflect the canvas id as the name to avoid 'Untitled' flicker
      if (isUuid && canvasName !== canvasIdParam) {
        setCanvasName(canvasIdParam);
        setCanvasId(canvasIdParam);
      }

      if (isUuid) {
        // Load existing canvas
        try {
          const { data: canvas, error } = await supabase
            .from('canvases')
            .select('*')
            .eq('id', canvasIdParam)
            .single();

          if (error) throw error;

          if (canvas) {
            logger.debug('🎨 Loading canvas:', canvas.id, canvas.name);
            logger.debug(
              'Canvas document has shapes:',
              Object.keys(canvas.document?.store?.['shape:custom'] || {}),
            );
            logger.debug('Conversation key:', canvas.conversation_key);

            setCanvasId(canvas.id);
            setCanvasName(canvas.name);
            setLastSaved(new Date(canvas.last_modified));
            try {
              localStorage.setItem('present:lastCanvasId', canvas.id);
            } catch { }

            // Determine write permission: owner or editor membership
            if (canvas.user_id === user.id) {
              setCanWrite(true);
            } else {
              try {
                const { data: membership, error: memErr } = await supabase
                  .from('canvas_members')
                  .select('role')
                  .eq('canvas_id', canvas.id)
                  .eq('user_id', user.id)
                  .maybeSingle();
                setCanWrite(!memErr && membership?.role === 'editor');
              } catch {
                setCanWrite(false);
              }
            }

            // Load the document into the editor
            try {
              if (canvas.document && typeof canvas.document === 'object') {
                editor.loadSnapshot(canvas.document);
              }
            } catch (e) {
              console.warn(
                '⚠️ [CanvasPersistence] Failed to load snapshot, continuing with empty editor',
                e,
              );
            }

            logger.debug('🎨 Canvas loaded successfully - shapes should appear');

            // CRITICAL: Rehydrate component store after canvas loads
            // The canvas document contains shapes, but componentStore is empty on reload
            setTimeout(() => {
              logger.debug('🔄 Starting component rehydration...');
              window.dispatchEvent(
                new CustomEvent('custom:rehydrateComponents', {
                  detail: { canvasId: canvas.id, conversationKey: canvas.conversation_key },
                }),
              );
            }, 100); // Small delay to ensure editor is fully loaded
          }
        } catch (error) {
          console.warn(
            '[CanvasPersistence] Canvas load failed or not accessible; continuing in view/collab mode',
            error,
          );
          // No redirect; keep current id for TLDraw sync. Mark as read-only for persistence.
          setCanWrite(false);
        }
      }
    };

    loadCanvas();
  }, [user, editor, router]);

  // React to canvas id changes broadcast from the page to keep name in sync immediately
  useEffect(() => {
    const handler = () => {
      try {
        const id = new URL(window.location.href).searchParams.get('id');
        if (id) {
          setCanvasId(id);
          setCanvasName((prev) => prev || id);
        }
      } catch { }
    };
    window.addEventListener('present:canvas-id-changed', handler);
    return () => window.removeEventListener('present:canvas-id-changed', handler);
  }, []);

  // Auto-save functionality
  const saveCanvas = useCallback(async () => {
    if (!enabled) return;
    if (!editor || !user?.id || isSaving) return;
    if (!canWrite) return; // respect read-only when not the owner

    setIsSaving(true);
    try {
      const snapshot = editor.getSnapshot();
      const conversationKey = thread?.id || null;
      // Prefer a name derived from canvas id until user customizes
      const urlParams = new URLSearchParams(window.location.search);
      const idParam = urlParams.get('id');
      // Default to the exact id as the name for new canvases
      const defaultName = idParam || canvasName;
      const now = new Date().toISOString();

      // Generate a lightweight SVG thumbnail of the current page
      let thumbnail: string | null = null;
      try {
        const shapeIds = Array.from(editor.getCurrentPageShapeIds());
        if (shapeIds.length > 0) {
          const svgResult = await editor.getSvgString(shapeIds);
          if (svgResult?.svg) {
            thumbnail = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgResult.svg)}`;
          }
        }
      } catch {
        // Ignore thumbnail errors; don't block save
        thumbnail = null;
      }

      if (canvasId) {
        // Update existing canvas
        const { error } = await supabase
          .from('canvases')
          .update({
            name: canvasName || defaultName,
            document: snapshot,
            conversation_key: conversationKey,
            last_modified: now,
            updated_at: now,
            // Store thumbnail preview if available
            thumbnail,
          })
          .eq('id', canvasId);

        if (error) throw error;
        setLastSaved(new Date());

        // Notify session sync to update the session's canvas_state
        try {
          window.dispatchEvent(
            new CustomEvent('custom:sessionCanvasSaved', { detail: { snapshot, canvasId } }),
          );
        } catch (e) {
          // no-op
        }
      } else {
        // Create new canvas
        const { data: newCanvas, error } = await supabase
          .from('canvases')
          .insert({
            user_id: user.id,
            name: defaultName,
            document: snapshot,
            conversation_key: conversationKey,
            is_public: false,
            last_modified: now,
            thumbnail,
          })
          .select()
          .single();

        if (error) throw error;

        setCanvasId(newCanvas.id);
        setLastSaved(new Date());
        try {
          localStorage.setItem('present:lastCanvasId', newCanvas.id);
        } catch { }

        // Notify session sync to update the session's canvas_state
        try {
          window.dispatchEvent(
            new CustomEvent('custom:sessionCanvasSaved', {
              detail: { snapshot, canvasId: newCanvas.id },
            }),
          );
        } catch (e) {
          // no-op
        }

        // Update URL with canvas ID
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('id', newCanvas.id);
        window.history.replaceState({}, '', newUrl.toString());
      }
    } catch (error) {
      console.error('Error saving canvas:', error);
      toast.error('Failed to save canvas');
    } finally {
      setIsSaving(false);
    }
  }, [editor, user, canvasId, canvasName, thread, isSaving, enabled, canWrite]);

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
    const unsubscribe = editor.store.listen(handleChange, { scope: 'document' });

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
    if (!canWrite) {
      toast.error("You don't have permission to save this canvas");
      return;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    await saveCanvas();
    toast.success('Canvas saved!');
  }, [saveCanvas, enabled, canWrite]);

  // Update canvas name
  const updateCanvasName = useCallback(
    async (newName: string) => {
      setCanvasName(newName);

      if (canvasId && user?.id) {
        try {
          const { error } = await supabase
            .from('canvases')
            .update({ name: newName })
            .eq('id', canvasId);

          if (error) throw error;
        } catch (error) {
          console.error('Error updating canvas name:', error);
        }
      }
    },
    [canvasId, user],
  );

  return {
    canvasId,
    canvasName,
    isSaving,
    lastSaved,
    saveCanvas: manualSave,
    updateCanvasName,
  };
}
