import { useEffect, useRef, useState, useCallback } from 'react';
import { Editor } from 'tldraw';
import { useRouter } from 'next/navigation';
import { usecustomThread } from '@custom-ai/react';
import { toast } from 'react-hot-toast';
import { supabase, type Canvas } from '@/lib/supabase';
import { createLogger } from '@/lib/utils';
import { useAuth } from './use-auth';

const getCanvasExtras = () => {
  if (typeof window === 'undefined') return {};
  const w = window as any;
  if (!w.__presentCanvasExtras) {
    w.__presentCanvasExtras = {};
  }
  return w.__presentCanvasExtras as Record<string, any>;
};

const ingestCanvasExtras = (document: Record<string, any> | null | undefined) => {
  if (!document) return;
  const extras = getCanvasExtras();
  if (document.components && typeof document.components === 'object') {
    extras.components = document.components;
  }
  if (typeof document.fairyState === 'string') {
    extras.fairyState = document.fairyState;
  }
  if (Array.isArray(document.fairyChat)) {
    extras.fairyChat = document.fairyChat;
  }
};

const mergeCanvasExtras = (snapshot: Record<string, any>) => {
  const extras = getCanvasExtras();
  if (extras.components && typeof extras.components === 'object') {
    snapshot.components = extras.components;
  }
  if (typeof extras.fairyState === 'string') {
    snapshot.fairyState = extras.fairyState;
  }
  if (Array.isArray(extras.fairyChat)) {
    snapshot.fairyChat = extras.fairyChat;
  }
};

export function useCanvasPersistence(editor: Editor | null, enabled: boolean = true) {
  const { user } = useAuth();
  const isParity =
    typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('parity') === '1';
  // Dev-only escape hatch so we can persist parity/local canvases without auth friction.
  // Never allow this in production, and only honor it for parity-tagged canvases.
  const allowParityWrite =
    process.env.NODE_ENV !== 'production' &&
    isParity &&
    process.env.NEXT_PUBLIC_CANVAS_PARITY_DEV === 'true';
  const allowUnauthedWrite = allowParityWrite;
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
      if (!editor) return;
      if (!user?.id && !allowUnauthedWrite) return;
      if (allowUnauthedWrite) {
        setCanWrite(true);
      }

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
            .maybeSingle();

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
            if (allowUnauthedWrite) {
              setCanWrite(true);
            } else if (user) {
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
            } else {
              setCanWrite(false);
            }

            // Load the document into the editor
            try {
              if (canvas.document && typeof canvas.document === 'object') {
                ingestCanvasExtras(canvas.document as Record<string, any>);
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
          } else {
            setCanWrite(allowParityWrite);
          }
        } catch (error) {
          console.warn(
            '[CanvasPersistence] Canvas load failed or not accessible; continuing in view/collab mode',
            error,
          );
          // In parity dev mode, keep write access even if fetch fails (RLS/anon)
          setCanWrite(Boolean(allowUnauthedWrite));
        }
      }
    };

    loadCanvas();
  }, [user, editor, router, allowUnauthedWrite]);

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
    let lastError: unknown = null;
    if (!enabled) return;
    if (!editor || isSaving) return;
    // In dev/parity flows we allow writes even when the viewer isn't the owner.
    if (!canWrite && !allowUnauthedWrite) return; // respect read-only when not the owner

    setIsSaving(true);
    try {
      const snapshot = editor.getSnapshot();
      mergeCanvasExtras(snapshot as Record<string, any>);
      const storeSnapshot =
        (snapshot as any)?.document?.store ?? (snapshot as any)?.store ?? undefined;
      if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true') {
        try {
          console.debug('[CanvasPersistence] saveCanvas snapshot', {
            shapeCount: Array.isArray(storeSnapshot?.shape)
              ? storeSnapshot.shape.length
              : Object.keys(storeSnapshot?.['shape:'] || {}).length,
            storeKeys: Object.keys(storeSnapshot || {}).slice(0, 5),
            canvasId,
            canWrite,
          });
        } catch {}
      }
      try {
        const w = window as any;
        w.__presentCanvasSaveCalls = (w.__presentCanvasSaveCalls ?? 0) + 1;
      } catch {}
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
        // Save via Supabase client (anon or service, depending on environment)
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
        if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true') {
          try {
            console.debug('[CanvasPersistence] saved canvas', {
              id: canvasId,
              shapes: Object.keys(storeSnapshot || {}).length,
              svg: Boolean(thumbnail),
            });
          } catch {}
        }
        try {
          const w = window as any;
          w.__presentCanvasSaveLastOk = Date.now();
        } catch {}
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
        // Create new canvas (only when a real user is present)
        if (!user?.id) {
          setCanWrite(false);
          return;
        }
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
      lastError = error;
      console.error('Error saving canvas:', error);
      toast.error('Failed to save canvas');
    } finally {
      setIsSaving(false);
      try {
        const w = window as any;
        if (lastError) {
          w.__presentCanvasSaveErrors = (w.__presentCanvasSaveErrors ?? 0) + 1;
          w.__presentCanvasSaveLastError = String(lastError);
        }
      } catch {}
    }
  }, [editor, user, canvasId, canvasName, thread, isSaving, enabled, canWrite, allowUnauthedWrite]);

  // Save shortly after agent actions arrive (as a backstop when editor listeners don’t fire)
  useEffect(() => {
    if (!enabled) return;
    const timerRef: { current: NodeJS.Timeout | null } = { current: null };
    const handler = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        saveCanvas();
      }, 1500);
    };
    window.addEventListener('present:agent_actions', handler);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      window.removeEventListener('present:agent_actions', handler);
    };
  }, [enabled, saveCanvas]);

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
    if (!canWrite && !allowUnauthedWrite) {
      toast.error("You don't have permission to save this canvas");
      return;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    await saveCanvas();
    toast.success('Canvas saved!');
  }, [saveCanvas, enabled, canWrite, allowUnauthedWrite]);

  // Debug hook: expose manual save in dev for instrumentation
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    try {
      (window as any).__presentCanvasCanWrite = canWrite || allowUnauthedWrite;
    } catch {}
    try {
      (window as any).__presentManualCanvasSave = saveCanvas;
    } catch {}
    return () => {
      try {
        delete (window as any).__presentManualCanvasSave;
        delete (window as any).__presentCanvasCanWrite;
      } catch {}
    };
  }, [saveCanvas, canWrite, allowUnauthedWrite]);

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
