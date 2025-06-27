/**
 * Simple Component Registry for Tambo
 * 
 * Instead of complex bus systems, use direct React patterns for component management.
 * This provides a single source of truth for all UI components across contexts.
 */

import React from 'react';

export interface ComponentInfo {
  messageId: string;
  componentType: string;
  props: Record<string, unknown>;
  contextKey: string;
  timestamp: number;
  updateCallback?: (patch: Record<string, unknown>) => void;
}

// Simple global component store using Map
class ComponentStore {
  private components = new Map<string, ComponentInfo>();
  private listeners: Set<() => void> = new Set();

  register(info: ComponentInfo) {
    this.components.set(info.messageId, {
      ...info,
      timestamp: Date.now(),
    });
    console.log(`[ComponentRegistry] Registered ${info.componentType} at ${info.messageId}`);
    this.notifyListeners();
  }

  async update(messageId: string, patch: Record<string, unknown>) {
    const component = this.components.get(messageId);
    
    if (!component) {
      return {
        success: false,
        error: `Component ${messageId} not found. Available: ${Array.from(this.components.keys()).join(', ')}`,
      };
    }

    // Update the stored props
    const updatedComponent = {
      ...component,
      props: { ...component.props, ...patch },
      timestamp: Date.now(),
    };
    this.components.set(messageId, updatedComponent);

    // Call the component's update callback if available
    if (component.updateCallback) {
      try {
        component.updateCallback(patch);
        console.log(`[ComponentRegistry] Updated ${messageId} with`, patch);
        this.notifyListeners();
        return { success: true };
      } catch (error) {
        console.error(`[ComponentRegistry] Update callback failed for ${messageId}:`, error);
        return {
          success: false,
          error: `Update callback failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    console.log(`[ComponentRegistry] Updated ${messageId} props (no callback)`);
    this.notifyListeners();
    return { success: true };
  }

  list(contextKey?: string): ComponentInfo[] {
    const components = Array.from(this.components.values());
    if (!contextKey) return components;
    return components.filter((c) => c.contextKey === contextKey);
  }

  remove(messageId: string) {
    this.components.delete(messageId);
    console.log(`[ComponentRegistry] Removed ${messageId}`);
    this.notifyListeners();
  }

  clear(contextKey?: string) {
    if (!contextKey) {
      this.components.clear();
      console.log(`[ComponentRegistry] Cleared all components`);
    } else {
      for (const [id, component] of this.components) {
        if (component.contextKey === contextKey) {
          this.components.delete(id);
        }
      }
      console.log(`[ComponentRegistry] Cleared components for context: ${contextKey}`);
    }
    this.notifyListeners();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }
}

// Global store instance
const componentStore = new ComponentStore();

// Global registry instance for tools to use
export class ComponentRegistry {
  static register(info: ComponentInfo) {
    componentStore.register(info);
  }

  static async update(messageId: string, patch: Record<string, unknown>) {
    return componentStore.update(messageId, patch);
  }

  static list(contextKey?: string) {
    return componentStore.list(contextKey);
  }

  static remove(messageId: string) {
    componentStore.remove(messageId);
  }

  static clear(contextKey?: string) {
    componentStore.clear(contextKey);
  }
}

// Hook for components to register themselves and listen to updates
export function useComponentRegistration(
  messageId: string,
  componentType: string,
  props: Record<string, unknown>,
  contextKey: string,
  updateCallback?: (patch: Record<string, unknown>) => void
) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    // Register the component
    ComponentRegistry.register({
      messageId,
      componentType,
      props,
      contextKey,
      timestamp: Date.now(),
      updateCallback,
    });

    // Subscribe to changes
    const unsubscribe = componentStore.subscribe(() => {
      forceUpdate();
    });

    return () => {
      ComponentRegistry.remove(messageId);
      unsubscribe();
    };
  }, [messageId, componentType, contextKey, updateCallback]);
}

// Simple hook to list components and rerender when they change
export function useComponentList(contextKey?: string) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    const unsubscribe = componentStore.subscribe(() => {
      forceUpdate();
    });
    return unsubscribe;
  }, []);

  return ComponentRegistry.list(contextKey);
} 