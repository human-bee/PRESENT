/** CanvasSpace hosts the TLDraw editor and coordinates canvas features. */

'use client';
import { cn, createLogger } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { usecustom } from '@custom-ai/react';
import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Editor } from 'tldraw';
import { Toaster } from 'react-hot-toast';

import { ComponentRegistry } from '@/lib/component-registry';
import { CanvasLiveKitContext } from '../livekit/livekit-room-connector';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '../../../lib/livekit/livekit-bus';
import { components } from '@/lib/custom';
import {
  useCanvasComponentStore,
  useCanvasRehydration,
  useCanvasThreadReset,
  useCanvasEvents,
  useCanvasInteractions,
} from './hooks';
import { useTldrawBranding } from './hooks';
import { BrandGridOverlay } from './BrandGridOverlay';

// Dynamic imports for heavy tldraw components - only load when needed

const TldrawWithCollaboration = dynamic(
  () =>
    import('@/components/ui/tldraw/tldraw-with-collaboration').then((mod) => ({
      default: mod.TldrawWithCollaboration,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full w-full">Loading canvas...</div>
    ),
  },
);

// Import types statically (they don't add to bundle size)
import { customShapeUtil, ToolboxShapeUtil, MermaidStreamShapeUtil, InfographicShapeUtil } from '@/components/ui/tldraw/tldraw-canvas';

// Suppress development noise and repetitive warnings
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const originalWarn = console.warn;
  const originalLog = console.log;
  let mcpLoadingCount = 0;
  const dispatcherLogsEnabled =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true';

  console.warn = (...args) => {
    const message = args.join(' ');
    // Filter out tldraw multiple instances warnings
    if (
      message.includes('You have multiple instances of some tldraw libraries active') ||
      message.includes('This can lead to bugs and unexpected behavior') ||
      message.includes('This usually means that your bundler is misconfigured')
    ) {
      return; // Skip these warnings
    }
    originalWarn.apply(console, args);
  };

  console.log = (...args) => {
    const message = args.join(' ');
    // Filter out repetitive MCP loading messages after first few
    if (message.includes('[MCP] Loading 4 MCP server(s)')) {
      mcpLoadingCount++;
      if (mcpLoadingCount > 3) {
        return; // Skip after showing 3 times
      }
    }
    if (
      message.includes('[Transcript] render state') ||
      message.includes('[RetroTimerEnhanced] Using provided custom message ID') ||
      (!dispatcherLogsEnabled && message.includes('[ComponentRegistry] '))
    ) {
      return;
    }
    originalLog.apply(console, args);
  };
}

/**
 * Props for the CanvasSpace component
 * @interface
 */
interface CanvasSpaceProps {
  /** Optional CSS class name for custom styling */
  className?: string;
  /** Optional callback to toggle transcript panel */
  onTranscriptToggle?: () => void;
}

/**
 * A canvas space component that displays multiple persistent rendered components
 * from chat messages with dynamic masonry layout and drag-and-drop functionality.
 * @component
 * @example
 * ```tsx
 * <CanvasSpace className="custom-styles" />
 * ```
 */
export function CanvasSpace({ className, onTranscriptToggle }: CanvasSpaceProps) {
  // TODO: Access the current context
  const { thread } = usecustom();
  const [editor, setEditor] = useState<Editor | null>(null);
  const previousThreadId = useRef<string | null>(null);
  const removedMessageIdsRef = useRef<Set<string>>(new Set());
  const livekitCtx = React.useContext(CanvasLiveKitContext);
  const room = useRoomContext();
  const bus = React.useMemo(() => createLiveKitBus(room), [room]);
  const snapshotTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitComponentSnapshot = React.useCallback(
    (reason: string, opts?: { force?: boolean }) => {
      if (!room || room.state !== 'connected') return;
      const currentRoom = livekitCtx?.roomName || room.name;
      if (!currentRoom) return;
      const entries = ComponentRegistry.list();
      const focusTypes = new Set([
        'DebateScorecard',
        'ResearchPanel',
        'RetroTimerEnhanced',
        'RetroTimer',
        'LivekitParticipantTile',
        'CrowdPulseWidget',
        'MeetingSummaryWidget',
        'InfographicWidget',
        'MemoryRecallWidget',
        'LinearKanbanBoard',
        'ActionItemTracker',
      ]);
      const selected = entries.filter((entry) => focusTypes.has(entry.componentType));
      if (selected.length === 0) return;
      const componentsPayload = selected.map((entry) => {
        let clonedProps: Record<string, unknown> = {};
        try {
          clonedProps = JSON.parse(JSON.stringify(entry.props ?? {}));
        } catch {
          clonedProps = { ...(entry.props ?? {}) };
        }
        const intentId =
          typeof (clonedProps as Record<string, unknown>).intentId === 'string'
            ? ((clonedProps as Record<string, string>).intentId as string)
            : null;
        return {
          componentId: entry.messageId,
          componentType: entry.componentType,
          intentId,
          lastUpdated: entry.lastUpdated ?? entry.timestamp ?? Date.now(),
          props: clonedProps,
        };
      });
      const sendSnapshot = () => {
        bus.send('component_snapshot', {
          type: 'component_snapshot',
          room: currentRoom,
          components: componentsPayload,
          reason,
          timestamp: Date.now(),
        });
      };

      if (opts?.force) {
        if (snapshotTimerRef.current) {
          clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = null;
        }
        sendSnapshot();
        return;
      }

      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
      }
      snapshotTimerRef.current = setTimeout(() => {
        snapshotTimerRef.current = null;
        sendSnapshot();
      }, 150);
    },
    [bus, livekitCtx?.roomName, room],
  );

  useEffect(() => {
    const handler = () => emitComponentSnapshot('component_store_update');
    window.addEventListener('present:component-store-updated', handler);
    emitComponentSnapshot('initial_mount', { force: true });
    return () => {
      window.removeEventListener('present:component-store-updated', handler);
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
    };
  }, [emitComponentSnapshot]);

  useEffect(() => {
    const off = bus.on('component_snapshot_request', (msg: any) => {
      const targetRoom = typeof msg?.room === 'string' ? msg.room : null;
      const currentRoom = livekitCtx?.roomName || room?.name;
      if (targetRoom && currentRoom && targetRoom !== currentRoom) {
        return;
      }
      emitComponentSnapshot('request', { force: true });
    });
    return off;
  }, [bus, emitComponentSnapshot, livekitCtx?.roomName, room?.name]);
  const logger = createLogger('CanvasSpace');
  const branding = useTldrawBranding({
    defaultFont: 'sans',
    defaultSize: 'm',
    defaultDash: 'solid',
    defaultColor: 'black',
    paletteEnabled: false,
    selectionCssVars: {
      // Copper highlight selection.
      '--tl-color-selection-fill': 'var(--present-accent-ring)',
      '--tl-color-selection-stroke': 'var(--present-accent)',
      '--tl-color-focus': 'var(--present-accent)',
      '--tl-color-selected': 'var(--present-accent)',
    },
  });

  const {
    componentStore,
    setMessageIdToShapeIdMap,
    addedMessageIds,
    setAddedMessageIds,
    addComponentToCanvas,
    queuePendingComponent,
    drainPendingComponents,
    removeComponentFromCanvas,
  } = useCanvasComponentStore(editor, logger);

  const addComponentToCanvasTracked = React.useCallback(
    (messageId: string, component: React.ReactNode, componentName?: string) => {
      const trimmedId = String(messageId || '').trim();
      if (trimmedId) {
        removedMessageIdsRef.current.delete(trimmedId);
      }
      addComponentToCanvas(messageId, component, componentName);
    },
    [addComponentToCanvas],
  );

  const { onDragOver, onDrop, toggleComponentToolbox, showOnboarding } = useCanvasInteractions({
    editor,
    componentStore,
    logger,
  });

  useCanvasRehydration({
    editor,
    componentStore,
    setMessageIdToShapeIdMap,
    setAddedMessageIds,
    logger,
  });

  useCanvasThreadReset({
    thread,
    editor,
    componentStore,
    setMessageIdToShapeIdMap,
    setAddedMessageIds,
    previousThreadId,
    logger,
  });

  useCanvasEvents({
    editor,
    addComponentToCanvas: addComponentToCanvasTracked,
    queuePendingComponent,
    drainPendingComponents,
    bus,
    logger,
  });

  useEffect(() => {
    const handler = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{ messageId?: string; componentId?: string }>).detail;
        const messageIdRaw = detail?.messageId ?? detail?.componentId;
        const messageId = typeof messageIdRaw === 'string' ? messageIdRaw.trim() : '';
        if (!messageId) return;
        removedMessageIdsRef.current.add(messageId);
        removeComponentFromCanvas(messageId);
      } catch (error) {
        logger.warn('remove_component handler failed', error);
      }
    };
    window.addEventListener('present:remove_component', handler as EventListener);
    return () => {
      window.removeEventListener('present:remove_component', handler as EventListener);
    };
  }, [removeComponentFromCanvas, logger]);

  // Provide shape utils synchronously at first render so the store registers them on mount
  const customShapeUtils = React.useMemo(() => {
    return [customShapeUtil, ToolboxShapeUtil, MermaidStreamShapeUtil, InfographicShapeUtil] as any[];
  }, []);

  const hasReconciledRegistry = useRef(false);

  // On first editor ready, reconcile with ComponentRegistry in case events were missed
  useEffect(() => {
    if (!editor) {
      hasReconciledRegistry.current = false;
      return;
    }
    if (hasReconciledRegistry.current) return;
    hasReconciledRegistry.current = true;
    const existing = ComponentRegistry.list();
    if (!existing || existing.length === 0) return;
    logger.info(`🧭 Reconciling ${existing.length} components from registry`);
    existing.forEach((info) => {
      if (removedMessageIdsRef.current.has(info.messageId)) return;
      if (addedMessageIds.has(info.messageId)) return;
      const compDef = components.find((c) => c.name === info.componentType);
      let node: React.ReactNode = null;
      if (compDef) {
        try {
          node = React.createElement(compDef.component as any, {
            __custom_message_id: info.messageId,
            ...(info.props || {}),
          });
        } catch {
          logger.warn('Failed to recreate component from registry', info.componentType);
        }
      }
      if (!node) {
        // Fallback minimal node
        node = React.createElement('div', null, `${info.componentType}`);
      }
      addComponentToCanvasTracked(info.messageId, node, info.componentType);
      logger.debug('✅ Reconciled component:', info.componentType, info.messageId);
    });
  }, [editor, addComponentToCanvasTracked, addedMessageIds, logger]);

  /**
   * Effect to automatically add the latest component from thread messages (optimized with debouncing)
   */
  useEffect(() => {
    if (!thread?.messages || !editor) {
      return;
    }

    // Debounce component addition to prevent excessive rendering
    const timeoutId = setTimeout(() => {
      const messagesWithComponents = thread.messages.filter(
        (msg: any) => (msg as any).renderedComponent,
      );

      if (messagesWithComponents.length > 0) {
        const latestMessage: any = messagesWithComponents[messagesWithComponents.length - 1];

        const messageId = latestMessage.id || `msg-${Date.now()}`;
        if (removedMessageIdsRef.current.has(messageId)) {
          return;
        }
        // Check using addedMessageIds state
        if (!addedMessageIds.has(messageId) && latestMessage.renderedComponent) {
          // Normalize renderedComponent into a real React element when needed
          let node: React.ReactNode = latestMessage.renderedComponent as React.ReactNode;
          if (!React.isValidElement(node)) {
            const maybe = latestMessage.renderedComponent as {
              type?: unknown;
              props?: Record<string, unknown>;
            };
            if (maybe && typeof maybe === 'object' && maybe.type) {
              if (typeof maybe.type === 'string') {
                const compDef = components.find((c) => c.name === maybe.type);
                if (compDef) {
                  try {
                    node = React.createElement(compDef.component as any, {
                      __custom_message_id: messageId,
                      ...(maybe.props || {}),
                    });
                  } catch { }
                }
              } else if (
                typeof maybe.type === 'function' ||
                (typeof maybe.type === 'object' && maybe.type)
              ) {
                try {
                  node = React.createElement(maybe.type as any, {
                    __custom_message_id: messageId,
                    ...(maybe.props || {}),
                  });
                } catch { }
              }
            }
          }

          addComponentToCanvasTracked(
            messageId,
            node,
            latestMessage.role === 'assistant' ? 'AI Response' : 'User Input',
          );
        }
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [thread?.messages, editor, addComponentToCanvasTracked, addedMessageIds]);


  // Export functionality is now handled by TldrawWithPersistence component

  const handleMount = React.useCallback((ed: Editor) => {
    setEditor(ed);
    branding.onMount(ed);
  }, [branding]);

  return (
    <div
      className={cn(
        'h-screen flex-1 flex flex-col bg-surface overflow-hidden relative',
        className,
      )}
      data-canvas-space="true"
    >
      {/* Toast notifications */}
      <Toaster
        position="bottom-left"
        toastOptions={{
          style: {
            background: 'var(--present-surface-elevated)',
            color: 'var(--present-text)',
            border: '1px solid var(--present-border)',
          },
          iconTheme: {
            primary: 'var(--present-accent)',
            secondary: 'var(--present-surface)',
          },
        }}
      />

      {/* Use tldraw with collaboration for sync support */}
      <div
        className="absolute inset-0 z-0"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* Subtle brand grid overlay (8px base, orange every 32px) */}
        <BrandGridOverlay editor={editor} />

        <TldrawWithCollaboration
          key={livekitCtx?.roomName || 'no-room'}
          onMount={handleMount}
          shapeUtils={customShapeUtils as any}
          componentStore={componentStore.current}
          className="absolute inset-0"
          onTranscriptToggle={onTranscriptToggle}
          onHelpClick={showOnboarding}
          onComponentToolboxToggle={toggleComponentToolbox}
          readOnly={false}
        />
      </div>

      {/* Component Toolbox is now rendered as a shape on canvas, not as a floating panel */}
      {/*
        The following is a placeholder for if you want to show some UI when the editor is not loaded
        or if there are no components. For now, Tldraw handles its own empty state.
      */}
      {!editor && (
        <div className="flex-1 flex items-center justify-center text-center p-8 h-full">
          <div className="space-y-6 max-w-md">
            <div className="text-8xl mb-6 animate-pulse">🎨</div>
            <div className="space-y-3">
              <p className="text-primary font-semibold text-xl">Loading canvas…</p>
              <p className="text-secondary text-base leading-relaxed">
                The canvas is initializing. Please wait a moment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
