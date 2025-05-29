"use client";

import { cn } from "@/lib/utils";
import { useTamboThread } from "@tambo-ai/react";
import { useEffect, useRef, useState, useCallback } from "react";
import * as React from "react";
import type { TamboThreadMessage } from "@tambo-ai/react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Interface for a persistent canvas component
 */
interface CanvasComponent {
  id: string;
  messageId: string;
  component: React.ReactNode;
  timestamp: number;
}

/**
 * Interface for component positioning in masonry layout
 */
interface ComponentPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Props for a draggable canvas item
 */
interface DraggableCanvasItemProps {
  id: string;
  component: React.ReactNode;
  position: ComponentPosition;
  onRemove: (id: string) => void;
  onSizeChange: (id: string, height: number) => void;
}

/**
 * A draggable canvas item component with masonry positioning
 */
function DraggableCanvasItem({ 
  id, 
  component, 
  position, 
  onRemove, 
  onSizeChange 
}: DraggableCanvasItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const contentRef = useRef<HTMLDivElement>(null);

  // Observe content size changes
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    let lastHeight = 0;

    // Initial measurement
    const updateHeight = () => {
      const rect = element.getBoundingClientRect();
      const newHeight = rect.height + 32; // Add padding for container
      
      // Only update if height significantly changed (avoid micro changes)
      if (Math.abs(newHeight - lastHeight) > 2) {
        lastHeight = newHeight;
        onSizeChange(id, newHeight);
      }
    };

    // Measure after a brief delay to ensure content is rendered
    const timeoutId = setTimeout(updateHeight, 100);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height + 32; // Add padding
        
        // Only update if height significantly changed
        if (Math.abs(newHeight - lastHeight) > 2) {
          lastHeight = newHeight;
          onSizeChange(id, newHeight);
        }
      }
    });

    resizeObserver.observe(element);
    
    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [id, onSizeChange]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? transition : 'all 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)', // Smooth ripple effect
    position: 'absolute' as const,
    left: position.x,
    top: position.y,
    width: position.width,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        "group bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-300",
        "p-2 pl-10 flex flex-col overflow-hidden relative",
        isDragging && "z-50 shadow-2xl scale-105"
      )}
    >
      {/* Drag handle and remove button - positioned on left side */}
      <div className="absolute left-2 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        <div
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-2 rounded-lg hover:bg-gray-100 transition-colors bg-white/80 backdrop-blur-sm shadow-sm"
          title="Drag to reposition"
        >
          <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a1 1 0 011 1v1H7a1 1 0 01-1-1V3a1 1 0 011-1zM7 6a1 1 0 011 1v1H7a1 1 0 01-1-1V7a1 1 0 011-1zM7 10a1 1 0 011 1v1H7a1 1 0 01-1-1v-1a1 1 0 011-1zM12 2a1 1 0 011 1v1h-1a1 1 0 01-1-1V3a1 1 0 011-1zM12 6a1 1 0 011 1v1h-1a1 1 0 01-1-1V7a1 1 0 011-1zM12 10a1 1 0 011 1v1h-1a1 1 0 01-1-1v-1a1 1 0 011-1z" />
          </svg>
        </div>
        <button
          onClick={() => onRemove(id)}
          className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors bg-white/80 backdrop-blur-sm shadow-sm"
          title="Remove component"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Component content */}
      <div ref={contentRef} className="flex-1 w-full">
        <div className="w-full h-full [&>*]:w-full [&>*]:max-w-full">
          {component}
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for calculating infinite canvas layout with center-outward ripple positioning
 */
function useInfiniteCanvasLayout(
  components: CanvasComponent[],
  containerWidth: number,
  containerHeight: number,
  componentHeights: Record<string, number>
) {
  const [positions, setPositions] = useState<ComponentPosition[]>([]);

  const calculateLayout = useCallback(() => {
    if (components.length === 0) {
      setPositions([]);
      return;
    }

    // Get viewport dimensions or use reasonable defaults
    const viewportWidth = containerWidth || (typeof window !== 'undefined' ? window.innerWidth : 1400);
    const viewportHeight = containerHeight || (typeof window !== 'undefined' ? window.innerHeight : 900);
    
    // Center point of the canvas (where newest component goes)
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    
    const gap = 32; // Space between components
    const defaultWidth = 380;
    const defaultHeight = 250;

    const newPositions: ComponentPosition[] = [];

    // Process components in reverse order so newest (last added) gets center position
    const reversedComponents = [...components].reverse();

    reversedComponents.forEach((component, index) => {
      const height = componentHeights[component.id] || defaultHeight;
      const width = defaultWidth;

      if (index === 0) {
        // Newest component always goes in the center
        newPositions.push({
          id: component.id,
          x: centerX - width / 2,
          y: centerY - height / 2,
          width,
          height,
        });
      } else {
        // Older components arranged in expanding concentric rings
        // Use a spiral pattern for more organic feel
        const ringNumber = Math.floor((index - 1) / 8) + 1; // 8 components per ring

        const baseRadius = ringNumber * 240; // Distance from center increases per ring
        
        // Add some variation to make it less rigid
        const radiusVariation = (Math.sin(index * 1.618) * 40); // Golden ratio for natural distribution
        const radius = baseRadius + radiusVariation;
        
        // Calculate angle - use golden angle for pleasing spiral distribution
        const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 radians
        const angle = index * goldenAngle + (ringNumber * 0.3); // Slight ring offset
        
        let x = centerX + Math.cos(angle) * radius - width / 2;
        let y = centerY + Math.sin(angle) * radius - height / 2;

        // Ensure components stay within a reasonable viewport area (with padding)
        const padding = 50;
        const maxX = viewportWidth - width - padding;
        const maxY = viewportHeight - height - padding;
        
        x = Math.max(padding, Math.min(x, maxX));
        y = Math.max(padding, Math.min(y, maxY));

        // Simple collision detection and adjustment
        let attempts = 0;
        let hasCollision = true;
        
        while (hasCollision && attempts < 20) {
          hasCollision = false;
          
          // Check collision with existing components
          for (const existingPos of newPositions) {
            const dx = Math.abs(x - existingPos.x);
            const dy = Math.abs(y - existingPos.y);
            const minDistanceX = (width + existingPos.width) / 2 + gap;
            const minDistanceY = (height + existingPos.height) / 2 + gap;
            
            if (dx < minDistanceX && dy < minDistanceY) {
              // Collision detected - move further out
              const adjustmentAngle = angle + (attempts * 0.5);
              const adjustmentRadius = radius + (attempts + 1) * 60;
              x = centerX + Math.cos(adjustmentAngle) * adjustmentRadius - width / 2;
              y = centerY + Math.sin(adjustmentAngle) * adjustmentRadius - height / 2;
              
              // Reapply bounds
              x = Math.max(padding, Math.min(x, maxX));
              y = Math.max(padding, Math.min(y, maxY));
              
              hasCollision = true;
              break;
            }
          }
          attempts++;
        }

        newPositions.push({
          id: component.id,
          x,
          y,
          width,
          height,
        });
      }
    });

    setPositions(newPositions);
  }, [components, containerWidth, containerHeight, componentHeights]);

  useEffect(() => {
    calculateLayout();
  }, [calculateLayout]);

  return positions;
}

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

  // State for managing multiple persistent components
  const [canvasComponents, setCanvasComponents] = useState<CanvasComponent[]>([]);
  const [componentHeights, setComponentHeights] = useState<Record<string, number>>({});
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousThreadId = useRef<string | null>(null);

  // Configure drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Calculate infinite canvas layout
  const positions = useInfiniteCanvasLayout(canvasComponents, containerWidth, containerHeight, componentHeights);

  // Observe container dimensions changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  /**
   * Effect to clear the canvas when switching between threads
   */
  useEffect(() => {
    if (
      !thread ||
      (previousThreadId.current && previousThreadId.current !== thread.id)
    ) {
      setCanvasComponents([]);
      setComponentHeights({});
    }
    previousThreadId.current = thread?.id ?? null;
  }, [thread]);

  /**
   * Add a new component to the canvas
   */
  const addComponentToCanvas = (messageId: string, component: React.ReactNode) => {
    const newComponent: CanvasComponent = {
      id: `canvas-${messageId}-${Date.now()}`,
      messageId,
      component,
      timestamp: Date.now(),
    };

    setCanvasComponents(prev => {
      // Check if component from this message already exists
      const existingIndex = prev.findIndex(c => c.messageId === messageId);
      if (existingIndex >= 0) {
        // Replace existing component from same message
        const updated = [...prev];
        updated[existingIndex] = newComponent;
        return updated;
      } else {
        // Add new component
        return [...prev, newComponent];
      }
    });
  };

  /**
   * Remove a component from the canvas
   */
  const removeComponent = (id: string) => {
    setCanvasComponents(prev => prev.filter(c => c.id !== id));
    setComponentHeights(prev => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  /**
   * Handle component size changes
   */
  const handleSizeChange = useCallback((id: string, height: number) => {
    setComponentHeights(prev => {
      // Only update if height actually changed to prevent infinite loops
      if (prev[id] === height) return prev;
      
      return {
        ...prev,
        [id]: height,
      };
    });
  }, []);

  /**
   * Handle drag end event for reordering components
   */
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setCanvasComponents((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over?.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  /**
   * Effect to handle custom 'tambo:showComponent' events
   */
  useEffect(() => {
    const handleShowComponent = (
      event: CustomEvent<{ messageId: string; component: React.ReactNode }>,
    ) => {
      try {
        addComponentToCanvas(event.detail.messageId, event.detail.component);
      } catch (error) {
        console.error("Failed to add component to canvas:", error);
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
  }, []);

  /**
   * Effect to automatically add the latest component from thread messages
   */
  useEffect(() => {
    if (!thread?.messages) {
      return;
    }

    const messagesWithComponents = thread.messages.filter(
      (msg: TamboThreadMessage) => msg.renderedComponent,
    );

    if (messagesWithComponents.length > 0) {
      const latestMessage =
        messagesWithComponents[messagesWithComponents.length - 1];
      
      // Auto-add the latest component if it's not already on canvas
      const messageId = latestMessage.id || `msg-${Date.now()}`;
      const existsOnCanvas = canvasComponents.some(c => c.messageId === messageId);
      
      if (!existsOnCanvas && latestMessage.renderedComponent) {
        addComponentToCanvas(messageId, latestMessage.renderedComponent);
      }
    }
  }, [thread?.messages, canvasComponents]);

  // Calculate total canvas area height based on positions
  const totalCanvasHeight = positions.length > 0 
    ? Math.max(...positions.map((p: ComponentPosition) => p.y + p.height)) + 48 // Extra bottom padding
    : 400; // Minimum height when empty

  return (
    <div
      className={cn(
        "h-screen flex-1 flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 overflow-hidden",
        className,
      )}
      data-canvas-space="true"
    >
      <div
        ref={scrollContainerRef}
        className="w-full flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[8px] [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-gray-100"
      >
        {canvasComponents.length > 0 ? (
          <div
            ref={containerRef}
            className="w-full p-6 relative"
            style={{ 
              minHeight: Math.max(totalCanvasHeight, 600),
              height: totalCanvasHeight > 0 ? totalCanvasHeight : 'auto'
            }}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={canvasComponents.map(c => c.id)}>
                {canvasComponents.map((canvasComponent, index) => {
                  const position = positions.find(p => p.id === canvasComponent.id);
                  
                  // Provide fallback position while layout is calculating
                  const fallbackPosition: ComponentPosition = {
                    id: canvasComponent.id,
                    x: 20,
                    y: 20 + (index * 300), // Stack with proper spacing
                    width: Math.min(380, (containerWidth || 1200) - 40),
                    height: 250,
                  };

                  return (
                    <DraggableCanvasItem
                      key={canvasComponent.id}
                      id={canvasComponent.id}
                      component={canvasComponent.component}
                      position={position || fallbackPosition}
                      onRemove={removeComponent}
                      onSizeChange={handleSizeChange}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8 h-full">
            <div className="space-y-6 max-w-md">
              <div className="text-8xl mb-6 animate-pulse">🎨</div>
              <div className="space-y-3">
                <p className="text-gray-700 font-semibold text-xl">Your Canvas Awaits</p>
                <p className="text-gray-500 text-base leading-relaxed">
                  Components will ripple outward from the center in beautiful spirals. 
                  Each new creation takes center stage while others gracefully move aside.
                </p>
              </div>
              <div className="text-sm text-gray-400 bg-white/50 rounded-lg p-4 backdrop-blur-sm">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span>🌊</span>
                  <span className="font-medium">Infinite Canvas Ripples</span>
                  <span>🌊</span>
                </div>
                <p>New components emerge at center, creating ripple effects outward</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
