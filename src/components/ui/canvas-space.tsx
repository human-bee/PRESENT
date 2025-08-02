/**
 * CanvasSpace Component
 * 
 * This is the main canvas component that displays the Tldraw canvas and handles
 * the creation and management of Tambo shapes.
 * 
 * DEVELOPER NOTES:
 * - Uses TldrawWithPersistence for persistent canvas state
 * - Handles Tambo shape creation and updates
 * - Manages message-to-shape mapping for persistent rendering
 * - Handles component addition and deletion
 * - Implements debounced component addition for performance
 * - Manages component state with optimistic updates
 * - Handles custom 'tambo:showComponent' events
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
 * - @tambo-ai/react: Tambo thread context
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

"use client";

import { cn } from "@/lib/utils";
import { useTamboThread } from "@tambo-ai/react";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as React from "react";
import dynamic from "next/dynamic";
import type { TamboThreadMessage } from "@tambo-ai/react";
import type { Editor } from 'tldraw';
import { nanoid } from 'nanoid';
import { Toaster } from "react-hot-toast";
import { useAuth } from "@/hooks/use-auth";
import { systemRegistry } from "@/lib/system-registry";
import type { StateEnvelope } from "@/lib/shared-state";
import { ComponentToolbox } from "./component-toolbox";

// Dynamic imports for heavy tldraw components - only load when needed
const TldrawCanvas = dynamic(() => import("./tldraw-canvas").then(mod => ({ default: mod.TldrawCanvas })), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full w-full">Loading canvas...</div>
});

const TldrawWithPersistence = dynamic(() => import("./tldraw-with-persistence").then(mod => ({ default: mod.TldrawWithPersistence })), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full w-full">Loading canvas...</div>
});

const TldrawWithCollaboration = dynamic(() => import("./tldraw-with-collaboration").then(mod => ({ default: mod.TldrawWithCollaboration })), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full w-full">Loading canvas...</div>
});

// Import types statically (they don't add to bundle size)
import type { TamboShapeUtil, TamboShape } from "./tldraw-canvas";

// Suppress development noise and repetitive warnings
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const originalWarn = console.warn;
  const originalLog = console.log;
  let mcpLoadingCount = 0;
  
  console.warn = (...args) => {
    const message = args.join(' ');
    // Filter out tldraw multiple instances warnings
    if (message.includes('You have multiple instances of some tldraw libraries active') ||
        message.includes('This can lead to bugs and unexpected behavior') ||
        message.includes('This usually means that your bundler is misconfigured')) {
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
  // Access the current Tambo thread context
  const { thread } = useTamboThread();
  const { user } = useAuth();
  const [editor, setEditor] = useState<Editor | null>(null);
  const previousThreadId = useRef<string | null>(null);
  
  // Component toolbox state
  const [isComponentToolboxOpen, setIsComponentToolboxOpen] = useState(false);
  
  const toggleComponentToolbox = useCallback(() => {
    setIsComponentToolboxOpen(prev => !prev);
  }, []);

  // Map message IDs to tldraw shape IDs
  const [messageIdToShapeIdMap, setMessageIdToShapeIdMap] = useState<Map<string, string>>(new Map());
  
  // Track which message IDs have been added to prevent duplicates
  const [addedMessageIds, setAddedMessageIds] = useState<Set<string>>(new Set());
  
  // Store React components separately from tldraw shapes to avoid structuredClone issues
  const componentStore = useRef<Map<string, React.ReactNode>>(new Map());

  // Memoize shapeUtils array to prevent re-renders (only on client side to avoid SSR issues)
  const customShapeUtils = useMemo(() => {
    // Only import TamboShapeUtil on client side to avoid SSR issues
    if (typeof window === 'undefined') return [];
    
    // Import TamboShapeUtil dynamically to avoid SSR issues with dynamic imports
    const { TamboShapeUtil } = require('./tldraw-canvas');
    return [TamboShapeUtil];
  }, []);

  // Dynamically load the runtime class for use on the client (type-only import above is erased at runtime)
  let RuntimeTamboShapeUtil: typeof import('./tldraw-canvas').TamboShapeUtil | undefined;
  if (typeof window !== 'undefined') {
     
    RuntimeTamboShapeUtil = require('./tldraw-canvas').TamboShapeUtil;
  }

  // Canvas persistence is now handled by TldrawWithPersistence component

  /**
   * Effect to clear the canvas and reset messageIdToShapeIdMap when switching between threads
   */
  useEffect(() => {
    if (
      !thread ||
      (previousThreadId.current && previousThreadId.current !== thread.id)
    ) {
      // Clear existing shapes from the tldraw editor
      if (editor) {
        const allShapes = editor.getCurrentPageShapes();
        if (allShapes.length > 0) {
          editor.deleteShapes(allShapes.map(s => s.id));
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
  const addComponentToCanvas = useCallback((messageId: string, component: React.ReactNode, componentName?: string) => {
    if (!editor) {
      console.warn("Editor not available, cannot add or update component on canvas.");
      return;
    }

    // Store the component separately to avoid structuredClone issues
    componentStore.current.set(messageId, component);
    
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
    
    const existingShapeId = messageIdToShapeIdMap.get(messageId);

    if (existingShapeId) {
      // Update existing shape - only update non-component props to avoid cloning issues
      editor.updateShapes<TamboShape>([
        {
          id: existingShapeId,
          type: 'tambo',
          props: {
            tamboComponent: messageId, // Store messageId as reference instead of component
            name: componentName || `Component ${messageId}`,
            // w, h could be updated if needed, potentially from component itself or new defaults
          },
        }
      ]);
      
      // Phase 4: Emit component update state
      const existingState = systemRegistry.getState(messageId);
      const stateEnvelope: StateEnvelope = {
        id: messageId,
        kind: 'component_updated',
        payload: {
          componentName: componentName || `Component ${messageId}`,
          shapeId: existingShapeId,
          canvasId: editor.store.id || 'default-canvas'
        },
        version: (existingState?.version || 0) + 1,
        ts: Date.now(),
        origin: 'browser'
      };
      systemRegistry.ingestState(stateEnvelope);
    } else {
      // Create new shape
      const defaultShapeProps = RuntimeTamboShapeUtil
        ? new RuntimeTamboShapeUtil().getDefaultProps()
        : { w: 300, h: 200 }; // sensible fallback to prevent crash
      const newShapeId = `shape:tambo-${nanoid()}`; // Generate a unique ID for the new shape with required prefix

      const viewport = editor.getViewportPageBounds();
      const x = viewport ? viewport.midX - defaultShapeProps.w / 2 : Math.random() * 500;
      const y = viewport ? viewport.midY - defaultShapeProps.h / 2 : Math.random() * 300;

      editor.createShapes<TamboShape>([
        {
          id: newShapeId,
          type: 'tambo',
          x,
          y,
          props: {
            tamboComponent: messageId, // Store messageId as reference instead of component
            name: componentName || `Component ${messageId}`,
            w: defaultShapeProps.w,
            h: defaultShapeProps.h,
          },
        },
      ]);

      // Add the new messageId -> shapeId mapping
      setMessageIdToShapeIdMap(prevMap => new Map(prevMap).set(messageId, newShapeId));
      // Mark this message as added
      setAddedMessageIds(prevSet => new Set(prevSet).add(messageId));
      
      // Phase 4: Emit component creation state
      const stateEnvelope: StateEnvelope = {
        id: messageId,
        kind: 'component_created',
        payload: {
          componentName: componentName || `Component ${messageId}`,
          shapeId: newShapeId,
          canvasId: editor.store.id || 'default-canvas',
          position: { x, y },
          size: { w: defaultShapeProps.w, h: defaultShapeProps.h }
        },
        version: 1,
        ts: Date.now(),
        origin: 'browser'
      };
      systemRegistry.ingestState(stateEnvelope);
    }
  }, [editor, messageIdToShapeIdMap]);


  /**
   * Effect to handle custom 'tambo:showComponent' events
   */
  useEffect(() => {
    const handleShowComponent = (
      event: CustomEvent<{ messageId: string; component: React.ReactNode }>,
    ) => {
      try {
        // Pass a name for the component based on the event if available, or a default
        addComponentToCanvas(event.detail.messageId, event.detail.component, "Rendered Component");
      } catch (error) {
        console.error("Failed to add component to canvas from event:", error);
      }
    };

    window.addEventListener(
      "tambo:showComponent",
      handleShowComponent as EventListener,
    );

    return () => {
      window.removeEventListener(
        "tambo:showComponent",
        handleShowComponent as EventListener,
      );
    };
  }, [addComponentToCanvas]);

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
        (msg: TamboThreadMessage) => msg.renderedComponent,
      );

      if (messagesWithComponents.length > 0) {
        const latestMessage =
          messagesWithComponents[messagesWithComponents.length - 1];
        
        const messageId = latestMessage.id || `msg-${Date.now()}`;
        // Check using addedMessageIds state
        if (!addedMessageIds.has(messageId) && latestMessage.renderedComponent) {
          addComponentToCanvas(messageId, latestMessage.renderedComponent, latestMessage.role === 'assistant' ? 'AI Response' : 'User Input');
        }
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [thread?.messages, editor, addComponentToCanvas, addedMessageIds]);

  // Helper function to show onboarding
  const showOnboarding = useCallback(() => {
    console.log('🆘 [CanvasSpace] Help button clicked - dispatching tambo:toolCall event');
    
    // Use the Tambo generate_ui_component tool instead
    window.dispatchEvent(
      new CustomEvent("tambo:toolCall", {
        detail: {
          tool: "generate_ui_component",
          args: ["show onboarding guide for canvas"]
        }
      })
    );
    
    console.log('✅ [CanvasSpace] tambo:toolCall event dispatched successfully');
  }, []);

  // Component creation handler for the toolbox
  const handleComponentCreate = useCallback((componentType: string) => {
    console.log('🔧 [ComponentToolbox] Creating component:', componentType);
    
    // Use the Tambo generate_ui_component tool to create the component
    window.dispatchEvent(
      new CustomEvent("tambo:toolCall", {
        detail: {
          tool: "generate_ui_component",
          args: [`create ${componentType} component`]
        }
      })
    );
    
    console.log('✅ [ComponentToolbox] Component creation event dispatched successfully');
  }, []);

  // Export functionality is now handled by TldrawWithPersistence component

  return (
    <div
      className={cn(
        "h-screen flex-1 flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 overflow-hidden relative",
        className,
      )}
      data-canvas-space="true"
    >
      {/* Toast notifications */}
      <Toaster position="bottom-left" />

      {/* Use tldraw with collaboration for sync support */}
      <TldrawWithCollaboration
        onMount={setEditor}
        shapeUtils={customShapeUtils}
        componentStore={componentStore.current}
        className="absolute inset-0"
        onTranscriptToggle={onTranscriptToggle}
        onHelpClick={showOnboarding}
        onComponentToolboxToggle={toggleComponentToolbox}
        readOnly={false}
      />
      
      {/* Component Toolbox */}
      <ComponentToolbox
        isOpen={isComponentToolboxOpen}
        onToggle={toggleComponentToolbox}
        onComponentCreate={handleComponentCreate}
      />
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
