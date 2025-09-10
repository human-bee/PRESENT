/**
 * Component Isolation System
 *
 * Prevents components from re-rendering when other components update
 */

import { useRef, useEffect } from 'react';

// Global component registry to track active components
const activeComponents = new Map<
  string,
  {
    id: string;
    lastUpdate: number;
    isUpdating: boolean;
  }
>();

// Debounce map to prevent rapid updates
const updateDebounce = new Map<string, NodeJS.Timeout>();

/**
 * Hook to isolate component updates
 */
export function useComponentIsolation(componentId: string, componentType: string) {
  const isolationId = useRef(`${componentType}-${componentId}-${Date.now()}`).current;
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    // Register component
    activeComponents.set(isolationId, {
      id: isolationId,
      lastUpdate: Date.now(),
      isUpdating: false,
    });

    // Cleanup on unmount
    return () => {
      activeComponents.delete(isolationId);
      const timeout = updateDebounce.get(isolationId);
      if (timeout) {
        clearTimeout(timeout);
        updateDebounce.delete(isolationId);
      }
    };
  }, [isolationId]);

  // Check if this component should update
  const shouldUpdate = (minInterval = 1000): boolean => {
    const now = Date.now();
    const lastUpdate = lastUpdateRef.current;

    // Prevent updates faster than minInterval
    if (now - lastUpdate < minInterval) {
      return false;
    }

    // Check if other components of same type are updating
    const sameTypeComponents = Array.from(activeComponents.values()).filter(
      (c) => c.id.startsWith(componentType) && c.id !== isolationId,
    );

    const recentlyUpdated = sameTypeComponents.some(
      (c) => c.isUpdating || now - c.lastUpdate < 500,
    );

    if (recentlyUpdated) {
      // Delay this update
      return false;
    }

    return true;
  };

  // Mark component as updating
  const startUpdate = () => {
    const component = activeComponents.get(isolationId);
    if (component) {
      component.isUpdating = true;
      component.lastUpdate = Date.now();
      lastUpdateRef.current = Date.now();
    }
  };

  // Mark update complete
  const endUpdate = () => {
    const component = activeComponents.get(isolationId);
    if (component) {
      component.isUpdating = false;
    }
  };

  // Debounced update function
  const debouncedUpdate = (callback: () => void, delay = 300) => {
    const existingTimeout = updateDebounce.get(isolationId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      if (shouldUpdate()) {
        startUpdate();
        callback();
        endUpdate();
      }
      updateDebounce.delete(isolationId);
    }, delay);

    updateDebounce.set(isolationId, timeout);
  };

  return {
    isolationId,
    shouldUpdate,
    startUpdate,
    endUpdate,
    debouncedUpdate,
  };
}

/**
 * Create isolated event bus for component communication
 */
export class IsolatedEventBus {
  private listeners = new Map<string, Set<(data: any) => void>>();
  private eventQueue = new Map<string, any[]>();
  private processing = false;

  subscribe(componentId: string, event: string, callback: (data: any) => void) {
    const key = `${componentId}:${event}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(key);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  emit(componentId: string, event: string, data: any) {
    const key = `${componentId}:${event}`;

    // Queue event
    if (!this.eventQueue.has(key)) {
      this.eventQueue.set(key, []);
    }
    this.eventQueue.get(key)!.push(data);

    // Process queue if not already processing
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    this.processing = true;

    // Process events with micro-task delays
    for (const [key, events] of this.eventQueue.entries()) {
      const listeners = this.listeners.get(key);
      if (listeners && events.length > 0) {
        const event = events.shift()!;

        // Notify listeners asynchronously
        await Promise.resolve();
        listeners.forEach((callback) => {
          try {
            callback(event);
          } catch (error) {
            console.error(`Error in event listener for ${key}:`, error);
          }
        });
      }

      // Remove empty queues
      if (events.length === 0) {
        this.eventQueue.delete(key);
      }
    }

    this.processing = false;

    // Continue processing if more events arrived
    if (this.eventQueue.size > 0) {
      this.processQueue();
    }
  }
}

// Global isolated event bus instance
export const isolatedEventBus = new IsolatedEventBus();
