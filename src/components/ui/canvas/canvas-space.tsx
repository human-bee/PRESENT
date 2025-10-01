/**
 * CanvasSpace Component
 *
 * This is the main canvas component that displays the Tldraw canvas and handles
 * the creation and management of custom shapes.
 *
 * DEVELOPER NOTES:
 * - Uses TldrawWithPersistence for persistent canvas state
 * - Handles custom shape creation and updates
 * - Manages message-to-shape mapping for persistent rendering
 * - Handles component addition and deletion
 * - Implements debounced component addition for performance
 * - Manages component state with optimistic updates
 * - Handles custom 'custom:showComponent' events
 * - Manages component store for persistent rendering
 * - Handles thread state changes and resets
 *
 * FEATURES:
 * - Dynamic masonry layout for responsive rendering
 * - Drag-and-drop functionality for component reordering
 * - Persistent rendering of components across thread state changes
 * - Optimized component addition with debouncing
 * - Toast notifications for UI feedback
 *
 * DEPENDENCIES:
 * - @/hooks/use-auth: Authentication state
 * - tldraw: Canvas editor
 * - react-hot-toast: Toast notifications
 * - nanoid: Unique ID generation
 *
 * STYLING:
 * - Uses Tailwind CSS for styling
 * - Implements responsive design with flexbox
 * - Uses gradient background for modern aesthetic
 * - Handles overflow with relative positioning
 */

'use client';

import { cn, createLogger } from '@/lib/utils';
import { useEffect, useRef, useState, useCallback } from 'react';
import { usecustom } from '@custom-ai/react';
import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Editor } from 'tldraw';
import { nanoid } from 'nanoid';
import { Toaster } from 'react-hot-toast';

import { ComponentRegistry } from '@/lib/component-registry';
import { createShapeId } from 'tldraw';
import { CanvasLiveKitContext } from './livekit/livekit-room-connector';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '../../lib/livekit/livekit-bus';
import { components } from '@/lib/custom';
import {
  useCanvasComponentStore,
  useCanvasRehydration,
  useCanvasThreadReset,
  useCanvasEvents,
} from './hooks';

// Dynamic imports for heavy tldraw components - only load when needed

const TldrawWithCollaboration = dynamic(
  () =>
    import('./tldraw-with-collaboration').then((mod) => ({
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
import { customShapeUtil, ToolboxShapeUtil, MermaidStreamShapeUtil } from './tldraw-canvas';

// Suppress development noise and repetitive warnings
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const originalWarn = console.warn;
  const originalLog = console.log;
  let mcpLoadingCount = 0;

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
  const livekitCtx = React.useContext(CanvasLiveKitContext);
  const room = useRoomContext();
  const bus = createLiveKitBus(room);
  const logger = createLogger('CanvasSpace');

  // Component toolbox toggle - creates toolbox shape on canvas
  const toggleComponentToolbox = useCallback(() => {
    if (!editor) {
      console.warn('Editor not available');
      return;
    }

    // Check if toolbox already exists
    const existingToolbox = editor.getCurrentPageShapes().find((shape) => shape.type === 'toolbox');

    if (existingToolbox) {
      // Remove existing toolbox
      editor.deleteShapes([existingToolbox.id]);
      logger.info('🗑️ Removed existing component toolbox');
    } else {
      // Create new toolbox shape
      const viewport = editor.getViewportPageBounds();
      const TOOLBOX_W = 56;
      const TOOLBOX_H = 560; // taller vertical column
      const x = viewport ? viewport.minX + 24 : 24; // near left edge
      const y = viewport ? viewport.midY - TOOLBOX_H / 2 : 24; // vertically centered

      editor.createShape({
        id: createShapeId(`toolbox-${nanoid()}`),
        type: 'toolbox',
        x,
        y,
        props: {
          w: TOOLBOX_W,
          h: TOOLBOX_H,
          name: 'Component Toolbox',
        },
      });

      logger.info('✅ Created component toolbox shape');
    }
  }, [editor, logger]);

  const {
    componentStore,
    setMessageIdToShapeIdMap,
    addedMessageIds,
    setAddedMessageIds,
    addComponentToCanvas,
    queuePendingComponent,
    drainPendingComponents,
  } = useCanvasComponentStore(editor, logger);

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
    addComponentToCanvas,
    queuePendingComponent,
    drainPendingComponents,
    bus,
    logger,
  });

  // Provide shape utils synchronously at first render so the store registers them on mount
  const customShapeUtils = React.useMemo(() => {
    return [customShapeUtil, ToolboxShapeUtil, MermaidStreamShapeUtil] as any[];
  }, []);

  // On first editor ready, reconcile with ComponentRegistry in case events were missed
  useEffect(() => {
    if (!editor) return;
    const existing = ComponentRegistry.list();
    if (!existing || existing.length === 0) return;
    logger.info(`🧭 Reconciling ${existing.length} components from registry`);
    existing.forEach((info) => {
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
      addComponentToCanvas(info.messageId, node, info.componentType);
      logger.debug('✅ Reconciled component:', info.componentType, info.messageId);
    });
  }, [editor, addComponentToCanvas, addedMessageIds, logger]);

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

          addComponentToCanvas(
            messageId,
            node,
            latestMessage.role === 'assistant' ? 'AI Response' : 'User Input',
          );
        }
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [thread?.messages, editor, addComponentToCanvas, addedMessageIds]);

  // Helper function to show onboarding
  const showOnboarding = useCallback(() => {
    logger.info('🆘 Help button clicked - creating onboarding guide');

    if (!editor) {
      console.warn('Editor not available');
      return;
    }

    // Create OnboardingGuide component directly
    const shapeId = createShapeId(nanoid());
    const OnboardingGuideComponent = components.find(
      (c) => c.name === 'OnboardingGuide',
    )?.component;

    if (OnboardingGuideComponent) {
      const componentInstance = React.createElement(OnboardingGuideComponent, {
        __custom_message_id: shapeId,
        context: 'canvas',
        autoStart: true,
        state: {},
        updateState: (patch: Record<string, unknown> | ((prev: any) => any)) => {
          if (!editor) return;
          const prev = {} as Record<string, unknown>;
          const next = typeof patch === 'function' ? (patch as any)(prev) : { ...prev, ...patch };
          editor.updateShapes([{ id: shapeId, type: 'custom' as const, props: { state: next } }]);
        },
      });
      componentStore.current.set(shapeId, componentInstance);
      try {
        window.dispatchEvent(new Event('present:component-store-updated'));
      } catch { }

      // Get center of viewport for placement
      const viewport = editor.getViewportPageBounds();
      const x = viewport ? viewport.midX - 200 : 100;
      const y = viewport ? viewport.midY - 150 : 100;

      editor.createShape({
        id: shapeId,
        type: 'custom',
        x,
        y,
        props: {
          w: 400,
          h: 300,
          customComponent: shapeId,
          name: 'OnboardingGuide',
        },
      });

      logger.info('✅ Onboarding guide created successfully');
    } else {
      logger.warn('OnboardingGuide component not found');
    }
  }, [editor, componentStore, logger]);

  // Export functionality is now handled by TldrawWithPersistence component

  return (
    <div
      className={cn(
        'h-screen flex-1 flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 overflow-hidden relative',
        className,
      )}
      data-canvas-space="true"
    >
      {/* Toast notifications */}
      <Toaster position="bottom-left" />

      {/* Use tldraw with collaboration for sync support */}
      <div
        className="absolute inset-0 z-0"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const componentType = e.dataTransfer.getData('application/custom-component');
          if (componentType && editor) {
            logger.info('📥 Dropping component:', componentType);
            const shapeId = createShapeId(nanoid());
            const Component = components.find((c) => c.name === componentType)?.component;
            if (Component) {
              const componentInstance = React.createElement(Component, {
                __custom_message_id: shapeId,
              });
              componentStore.current.set(shapeId, componentInstance);
              try {
                window.dispatchEvent(new Event('present:component-store-updated'));
              } catch { }
              const pos = editor.screenToPage({ x: e.clientX, y: e.clientY });
              editor.createShape({
                id: shapeId,
                type: 'custom',
                x: pos.x,
                y: pos.y,
                props: {
                  w: 300,
                  h: 200,
                  customComponent: shapeId,
                  name: componentType,
                },
              });
              logger.info('✅ Component dropped successfully');
            } else {
              logger.warn('Failed to find component for type:', componentType);
            }
          }
        }}
      >
        <TldrawWithCollaboration
          key={livekitCtx?.roomName || 'no-room'}
          onMount={setEditor}
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
              <p className="text-gray-700 font-semibold text-xl">Loading Canvas...</p>
              <p className="text-gray-500 text-base leading-relaxed">
                The canvas is initializing. Please wait a moment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
