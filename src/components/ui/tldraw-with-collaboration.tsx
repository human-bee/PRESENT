"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Tldraw,
  TLUiOverrides,
  TLComponents,
  Editor,
  TldrawUiMenuItem,
  useEditor,
} from "tldraw";
import {
  CustomMainMenu,
  CustomToolbarWithTranscript,
} from "./tldraw-with-persistence";
import { ReactNode, useCallback, useContext, useEffect, useMemo, useState, useRef } from "react";
import { useSyncDemo } from "@tldraw/sync";
import { CanvasLiveKitContext } from "./livekit-room-connector";
import { ComponentStoreContext } from "./tldraw-canvas";
import type { TamboShapeUtil, TamboShape } from "./tldraw-canvas";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import TldrawSnapshotBroadcaster from '@/components/TldrawSnapshotBroadcaster';
import TldrawSnapshotReceiver from '@/components/TldrawSnapshotReceiver';

interface TldrawWithCollaborationProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
  onHelpClick?: () => void;
  onComponentToolboxToggle?: () => void;
  readOnly?: boolean;
}

const createCollaborationOverrides = (): TLUiOverrides => {
  return {
    actions: (editor, actions) => {
      const pinAction = {
        id: 'pin-shape-to-viewport',
        label: 'Pin to Window',
        icon: 'external-link',
        kbd: 'shift+p',
        onSelect: () => {
          const selectedShapes = editor.getSelectedShapes();
          
          if (selectedShapes.length === 1 && selectedShapes[0].type === 'tambo') {
            const shape = selectedShapes[0] as TamboShape;
            const isPinned = shape.props.pinned ?? false;
            
            if (!isPinned) {
              const viewport = editor.getViewportScreenBounds();
              const bounds = editor.getShapePageBounds(shape.id);
              if (bounds) {
                const screenPoint = editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
                const pinnedX = screenPoint.x / viewport.width;
                const pinnedY = screenPoint.y / viewport.height;
                
                editor.updateShapes([{
                  id: shape.id,
                  type: 'tambo',
                  props: {
                    pinned: true,
                    pinnedX: Math.max(0, Math.min(1, pinnedX)),
                    pinnedY: Math.max(0, Math.min(1, pinnedY)),
                  }
                }]);
              }
            } else {
              editor.updateShapes([{
                id: shape.id,
                type: 'tambo',
                props: { pinned: false }
              }]);
            }
          }
        },
        readonlyOk: false,
      };
      
      return {
        ...actions,
        'pin-shape-to-viewport': pinAction
      };
    },
    
    menu: (editor, menu, { source }) => {
      if (source === 'main-menu') {
        menu.push({
          id: 'pin-action-group',
          type: 'group',
          label: 'Pin Actions',
          children: [
            {
              id: 'pin-shape-to-viewport',
              type: 'item',
              label: 'Pin Selected Shape to Window',
              onSelect: () => {
                editor.runAction('pin-shape-to-viewport');
              }
            }
          ]
        });
      }
      
      return menu;
    }
  };
};

export function TldrawWithCollaboration({
  onMount,
  shapeUtils,
  componentStore,
  className,
  onTranscriptToggle,
  onHelpClick,
  onComponentToolboxToggle,
  readOnly = false,
}: TldrawWithCollaborationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const livekitCtx = useContext(CanvasLiveKitContext);
  const roomName = livekitCtx?.roomName ?? "tambo-canvas-room";

  // Detect role from LiveKit token metadata
  const room = useRoomContext();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;

    const updateRole = () => {
      const meta = room.localParticipant?.metadata;
      if (meta) {
        try {
          const parsed = JSON.parse(meta);
          if (parsed && typeof parsed.role === "string") {
            setRole(parsed.role);
          }
        } catch {
          // ignore parse errors
        }
      }
    };

    updateRole();
    room.on(RoomEvent.LocalTrackPublished, updateRole);
    // No specific metadata changed event for local participant, but re-check on publish events.

    return () => {
      room.off(RoomEvent.LocalTrackPublished, updateRole);
    };
  }, [room]);

  const computedReadOnly = readOnly || role === "viewer" || role === "readOnly";

  // Use useSyncDemo for development - allow overriding sync host via env
  // Preferred host is the HTTPS demo worker, which will negotiate the correct secure WebSocket URL.
  const envHost = process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || process.env.NEXT_PUBLIC_TLDRAW_SYNC_HOST;
  const computedHost = useMemo(() => {
    if (!envHost) return 'https://tldraw-sync-demo.tldraw.com';
    // Accept forms like ws(s)://ws.tldraw.dev or https://.../connect
    try {
      const url = new URL(envHost);
      // If it's ws(s), force https base so the library will choose wss correctly
      if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        url.protocol = 'https:';
        url.pathname = url.pathname.replace(/\/?connect\/?$/, '').replace(/\/+$/, '');
        return url.origin;
      }
      // If it already includes /connect at the end, drop it; useSyncDemo adds it
      url.pathname = url.pathname.replace(/\/?connect\/?$/, '').replace(/\/+$/, '');
      return url.origin;
    } catch {
      return 'https://tldraw-sync-demo.tldraw.com';
    }
  }, [envHost]);

  const safeHost = useMemo(() => {
    try {
      const u = new URL(computedHost);
      return u.origin;
    } catch {
      return 'https://tldraw-sync-demo.tldraw.com';
    }
  }, [computedHost]);

  const store = useSyncDemo({
    roomId: roomName,
    shapeUtils: shapeUtils || [],
    // pass host so the library builds the right /connect URL and negotiates wss
    host: safeHost,
  } as any);



  // Create memoised overrides & components
  const overrides = useMemo(() => createCollaborationOverrides(), []);
  const MainMenuWithPermissions = useCallback(
     
    (props: Record<string, unknown>) => (
      <CustomMainMenu {...(props as any)} readOnly={computedReadOnly} />
    ),
    [computedReadOnly]
  );

  const components: TLComponents = useMemo(
    () => ({
      Toolbar: (props) => (
        <CustomToolbarWithTranscript
          {...props}
          onTranscriptToggle={onTranscriptToggle}
          onHelpClick={onHelpClick}
          onComponentToolboxToggle={onComponentToolboxToggle}
        />
      ),
      MainMenu: MainMenuWithPermissions as any,
    }),
    [onTranscriptToggle, onHelpClick, onComponentToolboxToggle, MainMenuWithPermissions]
  );

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      // Expose editor globally for tools that need direct access
      if (typeof window !== 'undefined') {
        (window as any).__present = (window as any).__present || {};
        (window as any).__present.tldrawEditor = mountedEditor;
        try {
          window.dispatchEvent(new CustomEvent('present:editor-mounted', { detail: { editor: mountedEditor } }))
        } catch {}
      }

      // Set up global pin management using side effects
      let isUpdatingPinnedShapes = false;

      const updateAllPinnedShapes = () => {
        if (isUpdatingPinnedShapes) return;

        try {
          isUpdatingPinnedShapes = true;
          
          const allShapes = mountedEditor.getCurrentPageShapes();
          const pinnedShapes = allShapes.filter(
            (shape): shape is TamboShape => 
              shape.type === 'tambo' && (shape as TamboShape).props.pinned === true
          );

          if (pinnedShapes.length === 0) return;

          const viewport = mountedEditor.getViewportScreenBounds();
          const updates = [];

          for (const shape of pinnedShapes) {
            const pinnedX = shape.props.pinnedX ?? 0.5;
            const pinnedY = shape.props.pinnedY ?? 0.5;

            // Calculate screen position from pinned viewport coordinates
            const screenX = viewport.width * pinnedX;
            const screenY = viewport.height * pinnedY;

            // Convert to page coordinates
            const pagePoint = mountedEditor.screenToPage({ x: screenX, y: screenY });

            // Update shape position
            updates.push({
              id: shape.id,
              type: 'tambo' as const,
              x: pagePoint.x - shape.props.w / 2,
              y: pagePoint.y - shape.props.h / 2,
            });
          }

          if (updates.length > 0) {
            mountedEditor.updateShapes(updates);
          }
        } finally {
          isUpdatingPinnedShapes = false;
        }
      };

      // Register camera change handler for pinned shapes
      const cameraCleanup = mountedEditor.sideEffects.registerAfterChangeHandler('camera', updateAllPinnedShapes);

      // Also handle viewport resize
      const handleResize = () => {
        updateAllPinnedShapes();
      };

      window.addEventListener('resize', handleResize);

      // Initial update
      setTimeout(updateAllPinnedShapes, 100);

      // Event handlers for canvas control (PRE-105)
      const handleFocusEvent = (e: Event) => {
        const detail = (e as CustomEvent).detail || {};
        const target: 'all' | 'selected' | 'component' | 'shape' = detail.target || 'all';
        const padding: number = typeof detail.padding === 'number' ? detail.padding : 64;

        try {
          if (target === 'all') {
            if ((mountedEditor as any).zoomToFit) {
              (mountedEditor as any).zoomToFit();
            } else {
              const bounds = mountedEditor.getCurrentPageBounds();
              if (bounds && (mountedEditor as any).zoomToBounds) {
                (mountedEditor as any).zoomToBounds(bounds, { animation: { duration: 320 }, inset: padding });
              }
            }
            return;
          }

          if (target === 'selected') {
            if ((mountedEditor as any).zoomToSelection) {
              (mountedEditor as any).zoomToSelection({ inset: padding });
              return;
            }
          }

          let shapeId: string | null = null;
          if (target === 'shape' && detail.shapeId) {
            shapeId = detail.shapeId;
          }
          if (target === 'component' && detail.componentId) {
            // Find tambo shape by messageId stored in props.tamboComponent
            const tambo = mountedEditor
              .getCurrentPageShapes()
              .find((s: any) => s.type === 'tambo' && s.props?.tamboComponent === detail.componentId);
            shapeId = tambo?.id ?? null;
          }

          if (shapeId) {
            const b = mountedEditor.getShapePageBounds(shapeId as any);
            if (b && (mountedEditor as any).zoomToBounds) {
              (mountedEditor as any).zoomToBounds(b, { animation: { duration: 320 }, inset: padding });
            }
          }
        } catch (err) {
          console.warn('[CanvasControl] focus error', err);
        }
      };

      const handleZoomAll = () => {
        try {
          if ((mountedEditor as any).zoomToFit) {
            (mountedEditor as any).zoomToFit();
            return;
          }
          const bounds = mountedEditor.getCurrentPageBounds();
          if (bounds && (mountedEditor as any).zoomToBounds) {
            (mountedEditor as any).zoomToBounds(bounds, { animation: { duration: 320 } });
          }
        } catch (err) {
          console.warn('[CanvasControl] zoomAll error', err);
        }
      };

      const handleCreateNote = (e: Event) => {
        const detail = (e as CustomEvent).detail || {};
        const text: string = detail.text || 'Note';

        try {
          const viewport = mountedEditor.getViewportPageBounds();
          const x = viewport ? viewport.midX : 0;
          const y = viewport ? viewport.midY : 0;
          // Try to create a text shape; fallback to geo if needed
          try {
            mountedEditor.createShape({
              id: (mountedEditor as any).createShapeId?.('note') ?? undefined,
              type: 'text' as any,
              x: x - 100,
              y: y - 50,
              props: { text, autoSize: true },
            } as any);
          } catch {
            mountedEditor.createShape({
              id: (mountedEditor as any).createShapeId?.('note') ?? undefined,
              type: 'geo' as any,
              x: x - 100,
              y: y - 50,
              props: { text, w: 200, h: 100, geo: 'rectangle' },
            } as any);
          }
        } catch (err) {
          console.warn('[CanvasControl] create_note error', err);
        }
      };

      const handlePinSelected = () => {
        try {
          const selected = mountedEditor.getSelectedShapes();
          if (!selected.length) return;
          const viewport = mountedEditor.getViewportScreenBounds();
          const updates: any[] = [];
          for (const s of selected) {
            if ((s as any).type !== 'tambo') continue;
            const b = mountedEditor.getShapePageBounds((s as any).id);
            if (!b) continue;
            const screenPoint = mountedEditor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
            const pinnedX = screenPoint.x / viewport.width;
            const pinnedY = screenPoint.y / viewport.height;
            updates.push({ id: (s as any).id, type: 'tambo' as const, props: { pinned: true, pinnedX, pinnedY } });
          }
          if (updates.length) mountedEditor.updateShapes(updates);
        } catch (err) {
          console.warn('[CanvasControl] pin_selected error', err);
        }
      };

      const handleUnpinSelected = () => {
        try {
          const selected = mountedEditor.getSelectedShapes();
          const updates: any[] = [];
          for (const s of selected) {
            if ((s as any).type !== 'tambo') continue;
            updates.push({ id: (s as any).id, type: 'tambo' as const, props: { pinned: false } });
          }
          if (updates.length) mountedEditor.updateShapes(updates);
        } catch (err) {
          console.warn('[CanvasControl] unpin_selected error', err);
        }
      };

      const handleLockSelected = () => {
        try {
          const selected = mountedEditor.getSelectedShapes();
          if (!selected.length) return;
          const updates = selected.map((s: any) => ({ id: s.id, type: s.type, isLocked: true }));
          mountedEditor.updateShapes(updates as any);
        } catch (err) {
          console.warn('[CanvasControl] lock_selected error', err);
        }
      };

      const handleUnlockSelected = () => {
        try {
          const selected = mountedEditor.getSelectedShapes();
          if (!selected.length) return;
          const updates = selected.map((s: any) => ({ id: s.id, type: s.type, isLocked: false }));
          mountedEditor.updateShapes(updates as any);
        } catch (err) {
          console.warn('[CanvasControl] unlock_selected error', err);
        }
      };

      const handleArrangeGrid = (e: Event) => {
        try {
          const detail = (e as CustomEvent).detail || {};
          const selectionOnly = Boolean(detail.selectionOnly);
          const spacing = typeof detail.spacing === 'number' ? detail.spacing : 24;
          let targets = (mountedEditor.getSelectedShapes() as any[]).filter(s => s.type === 'tambo');
          if (!selectionOnly || targets.length === 0) {
            targets = (mountedEditor.getCurrentPageShapes() as any[]).filter(s => s.type === 'tambo');
          }
          if (targets.length === 0) return;

          // Compute grid
          const cols = detail.cols && Number.isFinite(detail.cols) ? Math.max(1, Math.floor(detail.cols)) : Math.ceil(Math.sqrt(targets.length));
          const rows = Math.ceil(targets.length / cols);
          const sizes = targets.map(s => ({ w: (s.props?.w ?? 300), h: (s.props?.h ?? 200) }));
          const maxW = Math.max(...sizes.map(s => s.w));
          const maxH = Math.max(...sizes.map(s => s.h));
          const viewport = mountedEditor.getViewportPageBounds();
          const totalW = cols * maxW + (cols - 1) * spacing;
          const totalH = rows * maxH + (rows - 1) * spacing;
          const left = viewport ? viewport.midX - totalW / 2 : 0;
          const top = viewport ? viewport.midY - totalH / 2 : 0;

          const updates = targets.map((s, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const x = left + c * (maxW + spacing);
            const y = top + r * (maxH + spacing);
            return { id: s.id, type: s.type as any, x, y };
          });
          mountedEditor.updateShapes(updates as any);
        } catch (err) {
          console.warn('[CanvasControl] arrange_grid error', err);
        }
      };

      const handleCreateRectangle = (e: Event) => {
        try {
          const detail = (e as CustomEvent).detail || {};
          const w = typeof detail.w === 'number' ? detail.w : 300;
          const h = typeof detail.h === 'number' ? detail.h : 200;
          const name = typeof detail.name === 'string' ? detail.name : 'Rectangle';
          const viewport = mountedEditor.getViewportPageBounds();
          const x = typeof detail.x === 'number' ? detail.x : (viewport ? viewport.midX - w / 2 : 0);
          const y = typeof detail.y === 'number' ? detail.y : (viewport ? viewport.midY - h / 2 : 0);
          mountedEditor.createShape({
            id: (mountedEditor as any).createShapeId?.('geo') ?? undefined,
            type: 'geo' as any,
            x,
            y,
            props: { w, h, name, geo: 'rectangle' },
          } as any);
        } catch (err) {
          console.warn('[CanvasControl] create_rectangle error', err);
        }
      };

      const handleCreateEllipse = (e: Event) => {
        try {
          const detail = (e as CustomEvent).detail || {};
          const w = typeof detail.w === 'number' ? detail.w : 280;
          const h = typeof detail.h === 'number' ? detail.h : 180;
          const name = typeof detail.name === 'string' ? detail.name : 'Ellipse';
          const viewport = mountedEditor.getViewportPageBounds();
          const x = typeof detail.x === 'number' ? detail.x : (viewport ? viewport.midX - w / 2 : 0);
          const y = typeof detail.y === 'number' ? detail.y : (viewport ? viewport.midY - h / 2 : 0);
          mountedEditor.createShape({
            id: (mountedEditor as any).createShapeId?.('geo') ?? undefined,
            type: 'geo' as any,
            x,
            y,
            props: { w, h, name, geo: 'ellipse' },
          } as any);
        } catch (err) {
          console.warn('[CanvasControl] create_ellipse error', err);
        }
      };

      const handleAlignSelected = (e: Event) => {
        try {
          const detail = (e as CustomEvent).detail || {};
          const axis: 'x'|'y' = detail.axis || 'x';
          const mode: string = detail.mode || (axis === 'x' ? 'center' : 'middle');
          const targets = (mountedEditor.getSelectedShapes() as any[]).filter(s => s.type === 'tambo');
          if (targets.length === 0) return;
          const bounds = targets
            .map(s => ({ s, b: mountedEditor.getShapePageBounds(s.id) }))
            .filter(x => !!x.b) as any[];
          if (!bounds.length) return;
          const minX = Math.min(...bounds.map(x => x.b.x));
          const maxX = Math.max(...bounds.map(x => x.b.x + x.b.w));
          const minY = Math.min(...bounds.map(x => x.b.y));
          const maxY = Math.max(...bounds.map(x => x.b.y + x.b.h));
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const updates: any[] = [];
          for (const { s, b } of bounds) {
            if (axis === 'x') {
              if (mode === 'left') updates.push({ id: s.id, type: s.type, x: minX });
              else if (mode === 'right') updates.push({ id: s.id, type: s.type, x: maxX - b.w });
              else /* center */ updates.push({ id: s.id, type: s.type, x: cx - b.w / 2 });
            } else {
              if (mode === 'top') updates.push({ id: s.id, type: s.type, y: minY });
              else if (mode === 'bottom') updates.push({ id: s.id, type: s.type, y: maxY - b.h });
              else /* middle */ updates.push({ id: s.id, type: s.type, y: cy - b.h / 2 });
            }
          }
          if (updates.length) mountedEditor.updateShapes(updates as any);
        } catch (err) {
          console.warn('[CanvasControl] align_selected error', err);
        }
      };

      const handleDistributeSelected = (e: Event) => {
        try {
          const detail = (e as CustomEvent).detail || {};
          const axis: 'x'|'y' = detail.axis || 'x';
          const targets = (mountedEditor.getSelectedShapes() as any[]).filter(s => s.type === 'tambo');
          if (targets.length < 3) return; // need at least 3 to distribute
          const items = targets
            .map(s => ({ s, b: mountedEditor.getShapePageBounds(s.id) }))
            .filter(x => !!x.b) as any[];
          if (items.length < 3) return;
          items.sort((a, b) => axis === 'x' ? a.b.x - b.b.x : a.b.y - b.b.y);
          const first = items[0];
          const last = items[items.length - 1];
          const span = axis === 'x' ? (last.b.x - first.b.x) : (last.b.y - first.b.y);
          const step = span / (items.length - 1);
          const updates: any[] = [];
          for (let i = 1; i < items.length - 1; i++) {
            const targetPos = (axis === 'x') ? (first.b.x + step * i) : (first.b.y + step * i);
            if (axis === 'x') updates.push({ id: items[i].s.id, type: items[i].s.type, x: targetPos });
            else updates.push({ id: items[i].s.id, type: items[i].s.type, y: targetPos });
          }
          if (updates.length) mountedEditor.updateShapes(updates as any);
        } catch (err) {
          console.warn('[CanvasControl] distribute_selected error', err);
        }
      };

      const handleDrawSmiley = (e: Event) => {
        try {
          const detail = (e as CustomEvent).detail || {};
          const size = typeof detail.size === 'number' ? detail.size : 300;
          const viewport = mountedEditor.getViewportPageBounds();
          const cx = viewport ? viewport.midX : 0;
          const cy = viewport ? viewport.midY : 0;

          // Face
          const faceW = size;
          const faceH = size;
          mountedEditor.createShape({
            id: (mountedEditor as any).createShapeId?.('smiley-face') ?? undefined,
            type: 'geo' as any,
            x: cx - faceW / 2,
            y: cy - faceH / 2,
            props: { w: faceW, h: faceH, geo: 'ellipse', name: 'Smiley Face' },
          } as any);

          // Eyes
          const eyeW = Math.max(16, size * 0.12);
          const eyeH = Math.max(16, size * 0.12);
          const eyeOffsetX = size * 0.22;
          const eyeOffsetY = size * 0.18;
          // Left eye
          mountedEditor.createShape({
            id: (mountedEditor as any).createShapeId?.('smiley-eye-l') ?? undefined,
            type: 'geo' as any,
            x: cx - eyeOffsetX - eyeW / 2,
            y: cy - eyeOffsetY - eyeH / 2,
            props: { w: eyeW, h: eyeH, geo: 'ellipse', name: 'Eye L' },
          } as any);
          // Right eye
          mountedEditor.createShape({
            id: (mountedEditor as any).createShapeId?.('smiley-eye-r') ?? undefined,
            type: 'geo' as any,
            x: cx + eyeOffsetX - eyeW / 2,
            y: cy - eyeOffsetY - eyeH / 2,
            props: { w: eyeW, h: eyeH, geo: 'ellipse', name: 'Eye R' },
          } as any);

          // Mouth (simple ellipse as placeholder)
          const mouthW = size * 0.5;
          const mouthH = size * 0.22;
          const mouthY = cy + size * 0.15;
          mountedEditor.createShape({
            id: (mountedEditor as any).createShapeId?.('smiley-mouth') ?? undefined,
            type: 'geo' as any,
            x: cx - mouthW / 2,
            y: mouthY - mouthH / 2,
            props: { w: mouthW, h: mouthH, geo: 'ellipse', name: 'Mouth' },
          } as any);
        } catch (err) {
          console.warn('[CanvasControl] draw_smiley error', err);
        }
      };

      window.addEventListener('tldraw:canvas_focus', handleFocusEvent as EventListener);
      window.addEventListener('tldraw:canvas_zoom_all', handleZoomAll as EventListener);
      window.addEventListener('tldraw:create_note', handleCreateNote as EventListener);
      window.addEventListener('tldraw:pinSelected', handlePinSelected as EventListener);
      window.addEventListener('tldraw:unpinSelected', handleUnpinSelected as EventListener);
      window.addEventListener('tldraw:lockSelected', handleLockSelected as EventListener);
      window.addEventListener('tldraw:unlockSelected', handleUnlockSelected as EventListener);
      window.addEventListener('tldraw:arrangeGrid', handleArrangeGrid as EventListener);
      window.addEventListener('tldraw:createRectangle', handleCreateRectangle as EventListener);
      window.addEventListener('tldraw:createEllipse', handleCreateEllipse as EventListener);
      window.addEventListener('tldraw:alignSelected', handleAlignSelected as EventListener);
      window.addEventListener('tldraw:distributeSelected', handleDistributeSelected as EventListener);
      window.addEventListener('tldraw:drawSmiley', handleDrawSmiley as EventListener);
      // New: grid/theme/background/select
      const handleToggleGrid = () => {
        const el = containerRef.current;
        if (!el) return;
        const has = el.dataset.grid === 'on';
        if (has) {
          delete el.dataset.grid;
          el.style.backgroundImage = '';
        } else {
          el.dataset.grid = 'on';
          el.style.backgroundImage = 'radial-gradient(circle, rgba(0,0,0,0.12) 1px, transparent 1px)';
          el.style.backgroundSize = '16px 16px';
        }
      };
      const handleSetBackground = (e: Event) => {
        const el = containerRef.current;
        if (!el) return;
        const detail = (e as CustomEvent).detail || {};
        if (detail.color) {
          el.style.backgroundColor = String(detail.color);
          if (el.dataset.grid !== 'on') el.style.backgroundImage = '';
        } else if (detail.image) {
          el.style.backgroundImage = `url(${detail.image})`;
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
        }
      };
      const handleSetTheme = (e: Event) => {
        const el = containerRef.current;
        if (!el) return;
        const detail = (e as CustomEvent).detail || {};
        const theme = String(detail.theme || '').toLowerCase();
        el.dataset.theme = theme === 'dark' ? 'dark' : 'light';
      };
      const handleSelect = (e: Event) => {
        try {
          const detail = (e as CustomEvent).detail || {};
          const nameQuery = (detail.nameContains as string | undefined)?.toLowerCase();
          const typeQuery = detail.type as string | undefined;
          const within = detail.withinBounds as { x: number; y: number; w: number; h: number } | undefined;
          const shapes = mountedEditor.getCurrentPageShapes().filter((s: any) => {
            if (typeQuery && s.type !== typeQuery) return false;
            if (nameQuery) {
              const n = (s.props?.name || s.props?.tamboComponent || s.id || '').toString().toLowerCase();
              if (!n.includes(nameQuery)) return false;
            }
            if (within) {
              const b = mountedEditor.getShapePageBounds(s.id);
              if (!b) return false;
              const inside = b.x >= within.x && b.y >= within.y && (b.x + b.w) <= (within.x + within.w) && (b.y + b.h) <= (within.y + within.h);
              if (!inside) return false;
            }
            return true;
          });
          const ids = shapes.map((s: any) => s.id);
          if (ids.length) {
            mountedEditor.select(ids as any);
            if ((mountedEditor as any).zoomToSelection) (mountedEditor as any).zoomToSelection({ inset: 48 });
          }
        } catch (err) {
          console.warn('[CanvasControl] select error', err);
        }
      };

      window.addEventListener('tldraw:toggleGrid', handleToggleGrid as EventListener);
      window.addEventListener('tldraw:setBackground', handleSetBackground as EventListener);
      window.addEventListener('tldraw:setTheme', handleSetTheme as EventListener);
      window.addEventListener('tldraw:select', handleSelect as EventListener);

      // Store cleanup function
      const cleanup = () => {
        cameraCleanup();
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('tldraw:canvas_focus', handleFocusEvent as EventListener);
        window.removeEventListener('tldraw:canvas_zoom_all', handleZoomAll as EventListener);
        window.removeEventListener('tldraw:create_note', handleCreateNote as EventListener);
        window.removeEventListener('tldraw:pinSelected', handlePinSelected as EventListener);
        window.removeEventListener('tldraw:unpinSelected', handleUnpinSelected as EventListener);
        window.removeEventListener('tldraw:lockSelected', handleLockSelected as EventListener);
        window.removeEventListener('tldraw:unlockSelected', handleUnlockSelected as EventListener);
        window.removeEventListener('tldraw:arrangeGrid', handleArrangeGrid as EventListener);
        window.removeEventListener('tldraw:createRectangle', handleCreateRectangle as EventListener);
        window.removeEventListener('tldraw:createEllipse', handleCreateEllipse as EventListener);
        window.removeEventListener('tldraw:alignSelected', handleAlignSelected as EventListener);
        window.removeEventListener('tldraw:distributeSelected', handleDistributeSelected as EventListener);
        window.removeEventListener('tldraw:drawSmiley', handleDrawSmiley as EventListener);
        window.removeEventListener('tldraw:toggleGrid', handleToggleGrid as EventListener);
        window.removeEventListener('tldraw:setBackground', handleSetBackground as EventListener);
        window.removeEventListener('tldraw:setTheme', handleSetTheme as EventListener);
        window.removeEventListener('tldraw:select', handleSelect as EventListener);
      };

      // Store cleanup in editor for later use
      (mountedEditor as any)._pinnedShapesCleanup = cleanup;

      if (onMount) onMount(mountedEditor);

      // Trigger component rehydration for collaborators who didn't load from persistence
      try {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('tambo:rehydrateComponents', { detail: {} }))
        }, 250);
      } catch {}
    },
    [onMount, overrides, shapeUtils, store]
  );

  // Keyboard shortcut for transcript
  useEffect(() => {
    if (!onTranscriptToggle) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onTranscriptToggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTranscriptToggle]);

  // Ready flag: hide overlay once sync store reports ready (status !== 'loading')
   
  const isStoreReady = !!store && (store as any).status !== 'loading';

  return (
    <div className={className} style={{ position: "absolute", inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          store={store}
          onMount={handleMount}
          shapeUtils={shapeUtils || []}
          components={components}
          overrides={overrides}
          forceMobile={true}
        />
        {/* Broadcast TLDraw snapshots to LiveKit and persist to Supabase session */}
        <TldrawSnapshotBroadcaster />
        {/* Receive TLDraw snapshots from LiveKit as a fallback when sync is degraded */}
        <TldrawSnapshotReceiver />
      </ComponentStoreContext.Provider>

      {!isStoreReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 pointer-events-none select-none">
          <div className="text-gray-500">
            Connecting to board… If this hangs, we’ll fall back to live snapshots.
          </div>
        </div>
      )}
    </div>
  );
}
