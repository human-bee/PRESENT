"use client";

import { cn } from "@/lib/utils";
import { useTamboThread } from "@tambo-ai/react";
import { useEffect, useRef, useState, useCallback } from "react";
import * as React from "react";
import type { TamboThreadMessage } from "@tambo-ai/react";
import { TldrawCanvas, TamboShapeUtil, TamboShape, registerComponent, unregisterComponent } from "./tldraw-canvas";
import type { Editor } from 'tldraw';
import { nanoid } from 'nanoid';

/**
 * Props for the CanvasSpace component
 * @interface
 */
interface CanvasSpaceProps {
  /** Optional CSS class name for custom styling */
  className?: string;
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
export function CanvasSpace({ className }: CanvasSpaceProps) {
  // Access the current Tambo thread context
  const { thread } = useTamboThread();
  const [editor, setEditor] = useState<Editor | null>(null);
  const previousThreadId = useRef<string | null>(null);

  // Keep track of message IDs that have already been added to the canvas
  const [addedMessageIds, setAddedMessageIds] = useState<Set<string>>(new Set());


  /**
   * Effect to clear the canvas and reset added message IDs when switching between threads
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
      
      // Clear the component registry for the previous thread
      if (previousThreadId.current) {
        addedMessageIds.forEach(messageId => {
          unregisterComponent(messageId);
        });
      }
      
      setAddedMessageIds(new Set()); // Reset the set of added message IDs
    }
    previousThreadId.current = thread?.id ?? null;
  }, [thread, editor, addedMessageIds]);

  /**
   * Add a new component to the tldraw canvas
   */
  const addComponentToCanvas = useCallback((messageId: string, component: React.ReactNode, componentName?: string) => {
    if (!editor) {
      console.warn("Editor not available, cannot add component to canvas.");
      return;
    }

    // Prevent adding the same component multiple times
    if (addedMessageIds.has(messageId)) {
      // console.log(`Component for message ${messageId} already on canvas.`);
      return;
    }

    // Register the component in our external registry
    registerComponent(messageId, component);

    // Get default properties for the Tambo shape
    const defaultShapeProps = new TamboShapeUtil().getDefaultProps();
    const shapeId = `shape:tambo-${nanoid()}`; // Generate a unique ID for the shape with required "shape:" prefix

    // Attempt to get viewport center for positioning
    const viewport = editor.getViewportPageBounds();
    const x = viewport ? viewport.midX - defaultShapeProps.w / 2 : Math.random() * 500;
    const y = viewport ? viewport.midY - defaultShapeProps.h / 2 : Math.random() * 300;

    editor.createShapes<TamboShape>([
      {
        id: shapeId,
        type: 'tambo', // Ensure this matches TamboShapeUtil.type
        x,
        y,
        props: {
          // Store serializable component data instead of the React component
          componentData: {
            type: 'tambo-component',
            props: {}, // Could store serializable props if needed
            messageId: messageId,
          },
          name: componentName || `Component ${messageId}`,
          w: defaultShapeProps.w,
          h: defaultShapeProps.h,
        },
      },
    ]);

    // Add the messageId to the set to track it
    setAddedMessageIds(prev => new Set(prev).add(messageId));

  }, [editor, addedMessageIds]);


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
   * Effect to automatically add the latest component from thread messages
   */
  useEffect(() => {
    if (!thread?.messages || !editor) {
      return;
    }

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
  }, [thread?.messages, editor, addComponentToCanvas, addedMessageIds]);

  /**
   * Cleanup effect to unregister components when the component unmounts
   */
  useEffect(() => {
    return () => {
      // Clean up all registered components when the component unmounts
      addedMessageIds.forEach(messageId => {
        unregisterComponent(messageId);
      });
    };
  }, [addedMessageIds]);

  return (
    <div
      className={cn(
        "h-screen flex-1 flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 overflow-hidden",
        className,
      )}
      data-canvas-space="true"
    >
      <TldrawCanvas
        onMount={setEditor}
        shapeUtils={[TamboShapeUtil]}
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
