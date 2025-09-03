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

import { cn } from '@/lib/utils';
import { useEffect, useRef, useState, useCallback } from 'react';
import { usecustom } from '@custom-ai/react';
import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Editor } from 'tldraw';
import { nanoid } from 'nanoid';
import { Toaster } from 'react-hot-toast';

import { systemRegistry } from '@/lib/system-registry';
import { ComponentRegistry } from '@/lib/component-registry';
import { createShapeId } from 'tldraw';

import { calculateInitialSize } from '@/lib/component-sizing'; // Add import for dynamic sizing
import { CanvasLiveKitContext } from './livekit-room-connector';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '../../lib/livekit/livekit-bus';
import { components } from '@/lib/custom';

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
import type { customShape as CustomShape } from './tldraw-canvas';

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
      console.log('🗑️ Removed existing component toolbox');
    } else {
      // Create new toolbox shape
      const viewport = editor.getViewportPageBounds();
      const x = viewport ? viewport.midX - 170 : 100;
      const y = viewport ? viewport.midY - 160 : 100;

      editor.createShape({
        id: createShapeId(`toolbox-${nanoid()}`),
        type: 'toolbox',
        x,
        y,
        props: {
          w: 340,
          h: 320,
          name: 'Component Toolbox',
        },
      });

      console.log('✅ Created component toolbox shape');
    }
  }, [editor]);

  // Map message IDs to tldraw shape IDs
  const [messageIdToShapeIdMap, setMessageIdToShapeIdMap] = useState<Map<string, string>>(
    new Map(),
  );

  // Track which message IDs have been added to prevent duplicates
  const [addedMessageIds, setAddedMessageIds] = useState<Set<string>>(new Set());

  // Store React components separately from tldraw shapes to avoid structuredClone issues
  const componentStore = useRef<Map<string, React.ReactNode>>(new Map());
  // Queue of components received before editor is ready
  const pendingComponentsRef = useRef<
    Array<{ messageId: string; node: React.ReactNode; name?: string }>
  >([]);

  // Load shape utils dynamically
  const [customShapeUtils, setCustomShapeUtils] = useState<unknown[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('./tldraw-canvas').then((mod) => {
        const utils = [
          (mod as any).customShapeUtil,
          (mod as any).ToolboxShapeUtil,
        ].filter(Boolean);
        setCustomShapeUtils(utils);
      });
    }
  }, []);

  // Component rehydration handler - restore componentStore after canvas reload
  useEffect(() => {
    const handleRehydration = () => {
      if (!editor) {
        console.log('🔄 [CanvasSpace] Editor not ready for rehydration, skipping...');
        return;
      }

      console.log('🔄 [CanvasSpace] Starting component rehydration...');
      const customShapes = editor
        .getCurrentPageShapes()
        .filter((shape) => shape.type === 'custom') as CustomShape[];

      console.log(`🔄 [CanvasSpace] Found ${customShapes.length} custom shapes to rehydrate`);

      customShapes.forEach((shape) => {
        let componentName = shape.props.name;
        const messageId = shape.props.customComponent;

        console.log(`🔄 [CanvasSpace] Rehydrating ${componentName} (${messageId})`);

        // Find component definition
        // Try exact match first
        let componentDef = components.find((c) => c.name === componentName);
        // Handle legacy and wrapper names that appeared in earlier saves
        if (!componentDef) {
          // Legacy chat label
          if (componentName === 'AI Response') {
            componentDef = components.find((c) => c.name === 'AIResponse');
            if (componentDef) componentName = 'AIResponse';
          }
          // Generic label from earlier showComponent flow
          if (!componentDef && componentName === 'Rendered Component') {
            componentDef = components.find((c) => c.name === 'AIResponse');
            if (componentDef) componentName = 'AIResponse';
          }
          // TODO: MessageProvider was deprecated, fix/replace this from first principles undserstanding of current codebase
          if (!componentDef && componentName === 'MessageProvider') {
            componentDef = components.find((c) => c.name === 'AIResponse');
            if (componentDef) componentName = 'AIResponse';
          }
        }
        if (componentDef) {
          // Recreate React component and add to store
          const Component = componentDef.component;
          const componentInstance = React.createElement(Component, {
            __custom_message_id: messageId,
            state: (shape.props as any).state || {},
            updateState: (patch: Record<string, unknown> | ((prev: any) => any)) => {
              if (!editor) return;
              const prev = ((shape.props as any).state as Record<string, unknown>) || {};
              const next = typeof patch === 'function' ? (patch as any)(prev) : { ...prev, ...patch };
              editor.updateShapes([{ id: shape.id, type: 'custom', props: { state: next } }]);
            },
          });
          componentStore.current.set(messageId, componentInstance);
          try {
            window.dispatchEvent(new Event('present:component-store-updated'));
          } catch { }

          // Update mapping
          setMessageIdToShapeIdMap((prev) => new Map(prev).set(messageId, shape.id));
          setAddedMessageIds((prev) => new Set(prev).add(messageId));

          console.log(`✅ [CanvasSpace] Rehydrated ${componentName} successfully`);
        } else {
          console.error(`❌ [CanvasSpace] Component definition not found for: ${componentName}`);

          // Fallback: Create a placeholder component for missing registrations
          const FallbackComponent = () => (
            <div
              style={{
                padding: '16px',
                border: '2px dashed #ff6b6b',
                borderRadius: '8px',
                backgroundColor: '#fff5f5',
                color: '#c92a2a',
              }}
            >
              <h3
                style={{
                  margin: '0 0 8px 0',
                  fontSize: '14px',
                  fontWeight: 'bold',
                }}
              >
                📦 Component Not Registered: {componentName}
              </h3>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px' }}>
                ID: <code>{messageId}</code>
              </p>
              <p style={{ margin: '0', fontSize: '11px', opacity: 0.8 }}>
                Please add &quot;{componentName}&quot; to custom.ts registry.
              </p>
            </div>
          );

          const fallbackInstance = React.createElement(FallbackComponent);
          componentStore.current.set(messageId, fallbackInstance);
          try {
            window.dispatchEvent(new Event('present:component-store-updated'));
          } catch { }

          // Still update mappings so the shape shows something
          setMessageIdToShapeIdMap((prev) => new Map(prev).set(messageId, shape.id));
          setAddedMessageIds((prev) => new Set(prev).add(messageId));

          console.log(`⚠️ [CanvasSpace] Created fallback for ${componentName}`);
        }
      });

      console.log(
        `🎯 [CanvasSpace] Rehydration complete! ComponentStore now has ${componentStore.current.size} components`,
      );
    };

    window.addEventListener('custom:rehydrateComponents', handleRehydration as EventListener);

    return () => {
      window.removeEventListener('custom:rehydrateComponents', handleRehydration as EventListener);
    };
  }, [editor]);

  // Canvas persistence is now handled by TldrawWithPersistence component

  /**
   * Effect to clear the canvas and reset messageIdToShapeIdMap when switching between threads
   */
  useEffect(() => {
    if (!thread || (previousThreadId.current && previousThreadId.current !== thread.id)) {
      // Clear existing shapes from the tldraw editor
      if (editor) {
        const allShapes = editor.getCurrentPageShapes();
        if (allShapes.length > 0) {
          editor.deleteShapes(allShapes.map((s) => s.id));
        }
      }
      setMessageIdToShapeIdMap(new Map()); // Reset the map
      setAddedMessageIds(new Set()); // Reset the added messages set
      componentStore.current.clear(); // Clear the component store
    }
    previousThreadId.current = thread?.id ?? null;
  }, [thread, editor]);

  /**
   * Add or update a component on the tldraw canvas
   */
  const addComponentToCanvas = useCallback(
    (messageId: string, component: React.ReactNode, componentName?: string) => {
      if (!editor) {
        console.warn('Editor not available, cannot add or update component on canvas.');
        return;
      }

      // Store the component separately to avoid structuredClone issues
      componentStore.current.set(messageId, component);
      try {
        window.dispatchEvent(new Event('present:component-store-updated'));
      } catch { }

      // Note: ComponentRegistry integration temporarily disabled to prevent infinite loops
      // Will be re-enabled once tldraw stability issues are resolved

      /*
    // Register with the new ComponentRegistry system
    if (component && React.isValidElement(component)) {
      const componentType = typeof component.type === 'function' 
        ? (component.type as { displayName?: string; name?: string }).displayName || 
          (component.type as { displayName?: string; name?: string }).name || 'CanvasComponent'
        : 'CanvasComponent';
      
      // Import ComponentRegistry dynamically to avoid circular imports
      import('@/lib/component-registry').then(({ ComponentRegistry }) => {
        ComponentRegistry.register({
          messageId,
          componentType,
          props: (component.props || {}) as Record<string, unknown>,
          contextKey: 'canvas', // Canvas context
          timestamp: Date.now(),
          updateCallback: (patch) => {
            console.log(`[Canvas] Component ${messageId} received update:`, patch);
            // The component should handle its own updates via the registry wrapper
          }
        });
      });
    }
    */

      const existingShapeId = messageIdToShapeIdMap.get(messageId) as
        | import('tldraw').TLShapeId
        | undefined;

      if (existingShapeId) {
        // Update existing shape - only update non-component props to avoid cloning issues
        editor.updateShapes<CustomShape>([
          {
            id: existingShapeId,
            type: 'custom',
            props: {
              customComponent: messageId, // Store messageId as reference instead of component
              name: componentName || `Component ${messageId}`,
              // w, h could be updated if needed, potentially from component itself or new defaults
            },
          },
        ]);

        // Phase 4: Emit component update state
        const existingState = systemRegistry.getState(messageId);
        const stateEnvelope = {
          id: messageId,
          kind: 'component_updated',
          payload: {
            componentName: componentName || `Component ${messageId}`,
            shapeId: existingShapeId,
            canvasId: editor.store.id || 'default-canvas',
          },
          version: (existingState?.version || 0) + 1,
          ts: Date.now(),
          origin: 'browser',
        };
        systemRegistry.ingestState(stateEnvelope);
      } else {
        // Create new shape
        const newShapeId = createShapeId(`shape-${nanoid()}`); // Generate a unique ID for the new shape with required prefix

        const viewport = editor.getViewportPageBounds();
        const initialSize = calculateInitialSize(componentName || 'Default');
        const x = viewport ? viewport.midX - initialSize.w / 2 : Math.random() * 500;
        const y = viewport ? viewport.midY - initialSize.h / 2 : Math.random() * 300;

        editor.createShapes<CustomShape>([
          {
            id: newShapeId,
            type: 'custom',
            x,
            y,
            props: {
              customComponent: messageId, // Store messageId as reference instead of component
              name: componentName || `Component ${messageId}`,
              w: initialSize.w,
              h: initialSize.h,
            },
          },
        ]);

        // Add the new messageId -> shapeId mapping
        setMessageIdToShapeIdMap((prevMap) => new Map(prevMap).set(messageId, newShapeId));
        // Mark this message as added
        setAddedMessageIds((prevSet) => new Set(prevSet).add(messageId));

        // Phase 4: Emit component creation state
        const stateEnvelope = {
          id: messageId,
          kind: 'component_created',
          payload: {
            componentName: componentName || `Component ${messageId}`,
            shapeId: newShapeId,
            canvasId: editor.store.id || 'default-canvas',
            position: { x, y },
            size: { w: initialSize.w, h: initialSize.h },
          },
          version: 1,
          ts: Date.now(),
          origin: 'browser',
        };
        systemRegistry.ingestState(stateEnvelope);
      }
    },
    [editor, messageIdToShapeIdMap],
  );

  /**
   * Effect to handle custom 'custom:showComponent' events
   */
  useEffect(() => {
    const handleShowComponent = (
      event: CustomEvent<{
        messageId: string;
        component: React.ReactNode | { type: string; props?: Record<string, unknown> };
      }>,
    ) => {
      try {
        let node: React.ReactNode = event.detail.component as React.ReactNode;
        let inferredName: string | undefined = 'Rendered Component';
        // If editor isn't ready yet, queue the component for later
        if (!editor) {
          // Normalize to React element if possible so we can render later without recomputing
          if (!React.isValidElement(node)) {
            const maybe = event.detail.component as {
              type?: string;
              props?: Record<string, unknown>;
            };
            if (maybe && typeof maybe === 'object' && typeof maybe.type === 'string') {
              const compDef = components.find((c) => c.name === maybe.type);
              if (compDef) {
                node = React.createElement(compDef.component as any, {
                  __custom_message_id: event.detail.messageId,
                  ...(maybe.props || {}),
                });
                inferredName = compDef.name;
              }
            }
          } else if (React.isValidElement(node)) {
            // Try to infer name from the React element's type and unwrap common provider wrappers
            const type: any = node.type as any;
            const typeName = (type?.displayName || type?.name || '').toString();
            if (typeName === 'customMessageProvider' || typeName.endsWith('Provider')) {
              const child = (node.props as any)?.children;
              if (React.isValidElement(child)) {
                node = child;
              }
            }
            // Match by component reference
            const compDefByRef = components.find(
              (c) => (c.component as any) === (node as any).type,
            );
            if (compDefByRef) {
              inferredName = compDefByRef.name;
            }
          }
          pendingComponentsRef.current.push({
            messageId: event.detail.messageId,
            node,
            name: inferredName,
          });
          console.log(
            '⏸️ [CanvasSpace] Queued component until editor is ready:',
            inferredName || 'component',
          );
          return;
        }
        if (!React.isValidElement(node)) {
          const maybe = event.detail.component as {
            type?: string;
            props?: Record<string, unknown>;
          };
          if (maybe && typeof maybe === 'object' && typeof maybe.type === 'string') {
            const compDef = components.find((c) => c.name === maybe.type);
            if (compDef) {
              node = React.createElement(compDef.component as any, {
                __custom_message_id: event.detail.messageId,
                ...(maybe.props || {}),
              });
              inferredName = compDef.name;
            }
          }
        } else {
          // Valid element – try to infer better name and unwrap provider
          const type: any = (node as any).type;
          const typeName = (type?.displayName || type?.name || '').toString();
          if (typeName === 'customMessageProvider' || typeName.endsWith('Provider')) {
            const child = (node as any)?.props?.children;
            if (React.isValidElement(child)) {
              node = child;
            }
          }
          const compDefByRef = components.find((c) => (c.component as any) === (node as any).type);
          if (compDefByRef) {
            inferredName = compDefByRef.name;
          }
        }
        addComponentToCanvas(event.detail.messageId, node, inferredName);
        try {
          bus.send('ui_mount', {
            type: 'ui_mount',
            id: event.detail.messageId,
            timestamp: Date.now(),
            source: 'ui',
            context: { name: inferredName },
          });
        } catch { }
      } catch (error) {
        console.error('Failed to add component to canvas from event:', error);
      }
    };

    window.addEventListener('custom:showComponent', handleShowComponent as EventListener);

    return () => {
      window.removeEventListener('custom:showComponent', handleShowComponent as EventListener);
    };
  }, [addComponentToCanvas, bus]);

  // Drain any queued components once editor is ready
  useEffect(() => {
    if (!editor) return;
    if (pendingComponentsRef.current.length === 0) return;
    const queued = [...pendingComponentsRef.current];
    pendingComponentsRef.current = [];
    queued.forEach(({ messageId, node, name }) => {
      addComponentToCanvas(messageId, node, name);
      try {
        bus.send('ui_mount', {
          type: 'ui_mount',
          id: messageId,
          timestamp: Date.now(),
          source: 'ui',
          context: { name },
        });
      } catch { }
      console.log('▶️ [CanvasSpace] Rendered queued component:', name || 'component');
    });
  }, [editor, addComponentToCanvas, bus]);

  // Rehydrate components shortly after any TLDraw document change (collaboration or local)
  useEffect(() => {
    if (!editor) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = editor.store.listen(
      () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          try {
            window.dispatchEvent(new CustomEvent('custom:rehydrateComponents', { detail: {} }));
          } catch { }
        }, 150);
      },
      { scope: 'document' },
    );
    return () => {
      unsubscribe();
      if (timeout) clearTimeout(timeout);
    };
  }, [editor]);

  // On first editor ready, reconcile with ComponentRegistry in case events were missed
  useEffect(() => {
    if (!editor) return;
    const existing = ComponentRegistry.list();
    if (!existing || existing.length === 0) return;
    console.log(`🧭 [CanvasSpace] Reconciling ${existing.length} components from registry`);
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
        } catch { }
      }
      if (!node) {
        // Fallback minimal node
        node = React.createElement('div', null, `${info.componentType}`);
      }
      addComponentToCanvas(info.messageId, node, info.componentType);
      console.log('✅ [CanvasSpace] Reconciled component:', info.componentType, info.messageId);
    });
  }, [editor, addComponentToCanvas, addedMessageIds]);

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
    console.log('🆘 [CanvasSpace] Help button clicked - creating onboarding guide');

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

      console.log('✅ Onboarding guide created successfully');
    } else {
      console.error('OnboardingGuide component not found');
    }
  }, [editor, componentStore]);

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
            console.log('📥 Dropping component:', componentType);
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
              console.log('✅ Component dropped successfully');
            } else {
              console.error('Failed to find component for type:', componentType);
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
