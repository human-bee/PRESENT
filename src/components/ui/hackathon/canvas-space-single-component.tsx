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
 * - Shows only the first component by walking forward from the first message
 *
 * FEATURES:
 * - First component display - shows only the first component that appears
 * - Persistent component display - once a component is shown, it stays there
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

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { TamboThreadMessage } from "@tambo-ai/react";
import { useTamboThread } from "@tambo-ai/react";
import { nanoid } from "nanoid";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import type { Editor } from "tldraw";
import { TamboShape, TamboShapeUtil } from "../tldraw-canvas";
import { TldrawWithPersistence } from "../tldraw-with-persistence";

// Suppress development noise and repetitive warnings
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const originalWarn = console.warn;
  const originalLog = console.log;
  let mcpLoadingCount = 0;

  console.warn = (...args) => {
    const message = args.join(" ");
    // Filter out tldraw multiple instances warnings
    if (
      message.includes(
        "You have multiple instances of some tldraw libraries active"
      ) ||
      message.includes("This can lead to bugs and unexpected behavior") ||
      message.includes("This usually means that your bundler is misconfigured")
    ) {
      return; // Skip these warnings
    }
    originalWarn.apply(console, args);
  };

  console.log = (...args) => {
    const message = args.join(" ");
    // Filter out repetitive MCP loading messages after first few
    if (message.includes("[MCP] Loading 4 MCP server(s)")) {
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
interface CanvasSpaceSingleComponentProps {
  /** Optional CSS class name for custom styling */
  className?: string;
  /** Optional callback to toggle transcript panel */
  onTranscriptToggle?: () => void;
}

/**
 * A canvas space component that displays the first persistent rendered component
 * from chat messages by walking forward from the first message in the thread.
 * Once a component is shown, it stays there forever.
 * @component
 * @example
 * ```tsx
 * <CanvasSpaceSingleComponent className="custom-styles" />
 * ```
 */
export default function CanvasSpaceSingleComponent({
  className,
  onTranscriptToggle,
}: CanvasSpaceSingleComponentProps) {
  // Access the current Tambo thread context
  const { thread } = useTamboThread();
  const { user } = useAuth();
  const [editor, setEditor] = useState<Editor | null>(null);
  const previousThreadId = useRef<string | null>(null);

  // Track if we've already shown a component for this thread
  const [hasShownComponent, setHasShownComponent] = useState<boolean>(false);

  // Map message IDs to tldraw shape IDs
  const [messageIdToShapeIdMap, setMessageIdToShapeIdMap] = useState<
    Map<string, string>
  >(new Map());

  // Track which message IDs have been added to prevent duplicates
  const [addedMessageIds, setAddedMessageIds] = useState<Set<string>>(
    new Set()
  );

  // Store React components separately from tldraw shapes to avoid structuredClone issues
  const componentStore = useRef<Map<string, React.ReactNode>>(new Map());

  // Canvas persistence is now handled by TldrawWithPersistence component

  /**
   * Effect to clear the canvas and reset state when switching between threads
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
          editor.deleteShapes(allShapes.map((s) => s.id));
        }
      }
      setMessageIdToShapeIdMap(new Map()); // Reset the map
      setAddedMessageIds(new Set()); // Reset the added messages set
      componentStore.current.clear(); // Clear the component store
      setHasShownComponent(false); // Reset the component shown flag
    }
    previousThreadId.current = thread?.id ?? null;
  }, [thread, editor]);

  /**
   * Add or update a component on the tldraw canvas
   */
  const addComponentToCanvas = useCallback(
    (messageId: string, component: React.ReactNode, componentName?: string) => {
      if (!editor) {
        console.warn(
          "Editor not available, cannot add or update component on canvas."
        );
        return;
      }

      // Store the component separately to avoid structuredClone issues
      componentStore.current.set(messageId, component);

      const existingShapeId = messageIdToShapeIdMap.get(messageId);

      if (existingShapeId) {
        // Update existing shape - only update non-component props to avoid cloning issues
        editor.updateShapes<TamboShape>([
          {
            id: existingShapeId as any, // Type assertion for TLShapeId
            type: "tambo",
            props: {
              tamboComponent: messageId, // Store messageId as reference instead of component
              name: componentName || `Component ${messageId}`,
              // w, h could be updated if needed, potentially from component itself or new defaults
            },
          },
        ]);
      } else {
        // Create new shape
        // Determine initial size based on component type and viewport
        const viewport = editor.getViewportPageBounds();
        const sizeInfo = require('@/lib/component-sizing');
        const initial = sizeInfo.calculateInitialSize(componentName || 'Default', viewport ? { width: viewport.width, height: viewport.height } : undefined);
        const defaultShapeProps = {
          w: initial.w,
          h: initial.h,
          tamboComponent: "",
          name: componentName || "Tambo Component",
        };
        const newShapeId = `shape:tambo-${nanoid()}` as any; // Type assertion for TLShapeId

        const viewport = editor.getViewportPageBounds();
        const x = viewport
          ? viewport.midX - defaultShapeProps.w / 2
          : Math.random() * 500;
        const y = viewport
          ? viewport.midY - defaultShapeProps.h / 2
          : Math.random() * 300;

        editor.createShapes<TamboShape>([
          {
            id: newShapeId,
            type: "tambo",
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
        setMessageIdToShapeIdMap((prevMap) =>
          new Map(prevMap).set(messageId, newShapeId)
        );
        // Mark this message as added
        setAddedMessageIds((prevSet) => new Set(prevSet).add(messageId));

        // Auto zoom to fit the new component
        setTimeout(() => {
          try {
            // Try different zoom-to-fit methods available in tldraw v3
            if (editor.zoomToFit) {
              editor.zoomToFit();
            } else if (editor.zoomToBounds) {
              // Get the bounds of the new shape and zoom to fit
              const shape = editor.getShape(newShapeId);
              if (shape && shape.type === "tambo") {
                const tamboShape = shape as TamboShape;
                const bounds = {
                  x: tamboShape.x,
                  y: tamboShape.y,
                  w: tamboShape.props.w,
                  h: tamboShape.props.h,
                };
                editor.zoomToBounds(bounds);
              }
            }
          } catch (error) {
            console.warn("Failed to auto-zoom to fit new component:", error);
          }
        }, 100); // Small delay to ensure the shape is fully rendered
      }
    },
    [editor, messageIdToShapeIdMap]
  );

  /**
   * Effect to handle custom 'tambo:showComponent' events
   */
  useEffect(() => {
    const handleShowComponent = (
      event: CustomEvent<{ messageId: string; component: React.ReactNode }>
    ) => {
      try {
        // Only show component if we haven't shown one yet for this thread
        if (!hasShownComponent) {
          addComponentToCanvas(
            event.detail.messageId,
            event.detail.component,
            "Rendered Component"
          );
          setHasShownComponent(true);
        }
      } catch (error) {
        console.error("Failed to add component to canvas from event:", error);
      }
    };

    window.addEventListener(
      "tambo:showComponent",
      handleShowComponent as EventListener
    );

    return () => {
      window.removeEventListener(
        "tambo:showComponent",
        handleShowComponent as EventListener
      );
    };
  }, [addComponentToCanvas, hasShownComponent]);

  /**
   * Effect to automatically add the first component from thread messages (optimized with debouncing)
   */
  useEffect(() => {
    if (!thread?.messages || !editor || hasShownComponent) {
      return;
    }

    // Debounce component addition to prevent excessive rendering
    const timeoutId = setTimeout(() => {
      // Walk forward from the first message to find the first component
      const messages = [...thread.messages]; // Create a copy to avoid mutating
      let firstComponentMessage: TamboThreadMessage | null = null;

      // Find the first message with a rendered component
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.renderedComponent) {
          firstComponentMessage = message;
          break;
        }
      }

      if (firstComponentMessage) {
        const messageId = firstComponentMessage.id || `msg-${Date.now()}`;

        // Check if this is the same component we're already showing
        const currentShapeId = messageIdToShapeIdMap.get(messageId);
        const isAlreadyShowing =
          currentShapeId && addedMessageIds.has(messageId);

        if (!isAlreadyShowing) {
          // Only clear existing shapes if we're showing a different component
          const allShapes = editor.getCurrentPageShapes();
          if (allShapes.length > 0) {
            editor.deleteShapes(allShapes.map((s) => s.id));
          }

          // Reset the maps since we're only showing one component
          setMessageIdToShapeIdMap(new Map());
          setAddedMessageIds(new Set());
          componentStore.current.clear();

          // Add the first component to the canvas
          addComponentToCanvas(
            messageId,
            firstComponentMessage.renderedComponent,
            firstComponentMessage.role === "assistant"
              ? "AI Response"
              : "User Input"
          );

          // Mark that we've shown a component
          setHasShownComponent(true);

          // Auto zoom to fit the new component after a short delay
          setTimeout(() => {
            try {
              if (editor.zoomToFit) {
                editor.zoomToFit();
              } else if (editor.zoomToBounds) {
                // Get all shapes and zoom to fit them
                const allShapes = editor.getCurrentPageShapes();
                if (allShapes.length > 0) {
                  const bounds = editor.getCurrentPageBounds();
                  if (bounds) {
                    editor.zoomToBounds(bounds);
                  }
                }
              } else if (editor.zoomToSelection) {
                // Select all shapes and zoom to selection
                const allShapes = editor.getCurrentPageShapes();
                if (allShapes.length > 0) {
                  const shapeIds = allShapes.map((s) => s.id);
                  editor.select(shapeIds);
                  editor.zoomToSelection();
                }
              }
            } catch (error) {
              console.warn("Failed to auto-zoom to fit component:", error);
            }
          }, 150); // Slightly longer delay for thread-based component addition
        }
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [
    thread?.messages,
    editor,
    addComponentToCanvas,
    messageIdToShapeIdMap,
    addedMessageIds,
    hasShownComponent,
  ]);

  // Export functionality is now handled by TldrawWithPersistence component

  return (
    <div
      className={cn(
        "h-screen flex-1 flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 overflow-hidden relative",
        className
      )}
      data-canvas-space="true"
    >
      {/* Toast notifications */}
      <Toaster position="bottom-left" />

      {/* Use integrated tldraw with persistence - no more overlapping menu bar */}
      <TldrawWithPersistence
        onMount={setEditor}
        shapeUtils={[TamboShapeUtil]}
        componentStore={componentStore.current}
        className="absolute inset-0"
        onTranscriptToggle={onTranscriptToggle}
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
              <p className="text-gray-700 font-semibold text-xl">
                Loading Canvas...
              </p>
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
