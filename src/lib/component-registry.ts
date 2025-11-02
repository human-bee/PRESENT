/**
 * Simple Component Registry for custom
 *
 * Instead of complex bus systems, use direct React patterns for component management.
 * This provides a single source of truth for all UI components across contexts.
 */

import React from 'react';

const isDevEnvironment =
  !(
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'production'
  );

export interface ComponentInfo {
  messageId: string;
  componentType: string;
  props: Record<string, unknown>;
  contextKey: string;
  timestamp: number;
  updateCallback?: (patch: Record<string, unknown>) => void;
  // Track the very first props so we can diff later
  originalProps?: Record<string, unknown>;
  // History of diffs for visualisation
  diffHistory?: PropertyDiff[];
}

// Simple property-level diff description
export type PropertyDiff = {
  key: string;
  previous: unknown;
  next: unknown;
  ts: number;
};

// Utility to compute shallow diff of two objects
function diffProps(
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const key of allKeys) {
    const prev = oldProps[key];
    const next = newProps[key];
    if (prev !== next) {
      diffs.push({ key, previous: prev, next, ts: Date.now() });
    }
  }
  return diffs;
}

// Simple global component store using Map
class ComponentStore {
  private components = new Map<string, ComponentInfo>();
  private listeners: Set<() => void> = new Set();
  private warnedTypeMessages = new Set<string>();
  private warnedCallbackMessages = new Set<string>();

  register(info: ComponentInfo) {
    const existing = this.components.get(info.messageId);
    if (
      existing &&
      isDevEnvironment &&
      typeof console !== 'undefined' &&
      existing.componentType !== info.componentType &&
      !this.warnedTypeMessages.has(info.messageId)
    ) {
      const warning = {
        messageId: info.messageId,
        previousType: existing.componentType,
        nextType: info.componentType,
      };
      try {
        console.warn('⚠️ [ComponentRegistry] Duplicate registration detected', warning);
      } catch {}
      this.warnedTypeMessages.add(info.messageId);
    }
    this.components.set(info.messageId, {
      ...info,
      props: { ...(existing?.props ?? {}), ...(info.props ?? {}) },
      originalProps,
      diffHistory: mergedDiffHistory,
      updateCallback: aggregatedCallback,
      timestamp: Date.now(),
    };

    this.components.set(info.messageId, nextComponent);
    console.log(`🧩 [ComponentRegistry] Registered ${info.componentType} at ${info.messageId}`);
    console.log(`🧩 [ComponentRegistry] Total components: ${this.components.size}`);
    this.notifyListeners();
    return token;
  }

  // Silent update that doesn't log registration message (for props updates)
  updatePropsOnly(
    messageId: string,
    props: Record<string, unknown>,
    updateCallback?: (patch: Record<string, unknown>) => void,
    registrationToken?: symbol,
  ) {
    const component = this.components.get(messageId);
    if (component) {
      if (
        updateCallback &&
        component.updateCallback &&
        component.updateCallback !== updateCallback &&
        isDevEnvironment &&
        typeof console !== 'undefined' &&
        !this.warnedCallbackMessages.has(messageId)
      ) {
        try {
          console.warn('⚠️ [ComponentRegistry] Update callback replaced via updatePropsOnly', {
            messageId,
            previousCallback: component.updateCallback.name || 'anonymous',
            nextCallback: updateCallback.name || 'anonymous',
          });
        } catch {}
        this.warnedCallbackMessages.add(messageId);
      }
      const updatedComponent = {
        ...component,
        props,
        updateCallback: updateCallback || aggregatedCallback,
        timestamp: Date.now(),
      };
      this.components.set(messageId, updatedComponent);
      // Don't call notifyListeners() to avoid re-renders during props updates
    }
  }

  async update(messageId: string, patch: Record<string, unknown>) {
    const component = this.components.get(messageId);

    if (!component) {
      return {
        success: false,
        error: `Component ${messageId} not found. Available: ${Array.from(this.components.keys()).join(', ')}`,
      };
    }

    const mergedProps = { ...component.props, ...patch };

    // Compute diffs
    const propDiffs = diffProps(component.props, mergedProps);

    const updatedComponent = {
      ...component,
      props: mergedProps,
      timestamp: Date.now(),
      originalProps: component.originalProps || component.props,
      diffHistory: [...(component.diffHistory || []), ...propDiffs],
    } as ComponentInfo;
    updatedComponent.updateCallback = this.getAggregatedCallback(messageId);
    this.components.set(messageId, updatedComponent);

    const callbackResult = this.runCallbacks(messageId, patch);
    if (!callbackResult.success) {
      return callbackResult;
    }

    console.log(`[ComponentRegistry] Updated ${messageId} props${callbackResult.invoked ? '' : ' (no callback)'}`);
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
    this.warnedTypeMessages.delete(messageId);
    this.warnedCallbackMessages.delete(messageId);
    console.log(`[ComponentRegistry] Removed ${messageId}`);
    this.notifyListeners();
  }

  release(messageId: string, token: symbol) {
    const callbacks = this.callbackMap.get(messageId);
    if (callbacks) {
      callbacks.delete(token);
      if (callbacks.size === 0) {
        this.callbackMap.delete(messageId);
      }
    }

    if (this.registrationCounts.has(messageId)) {
      const nextCount = (this.registrationCounts.get(messageId) ?? 1) - 1;
      if (nextCount <= 0) {
        this.registrationCounts.delete(messageId);
        this.components.delete(messageId);
        console.log(`[ComponentRegistry] Removed ${messageId}`);
        this.notifyListeners();
        return;
      }
      this.registrationCounts.set(messageId, nextCount);
    }

    const component = this.components.get(messageId);
    if (component) {
      const aggregatedCallback = this.getAggregatedCallback(messageId);
      const updatedComponent: ComponentInfo = {
        ...component,
        updateCallback: aggregatedCallback,
        timestamp: Date.now(),
      };
      this.components.set(messageId, updatedComponent);
      this.notifyListeners();
    }
  }

  clear(contextKey?: string) {
    if (!contextKey) {
      this.components.clear();
      this.callbackMap.clear();
      this.registrationCounts.clear();
      console.log(`[ComponentRegistry] Cleared all components`);
    } else {
      for (const [id, component] of this.components) {
        if (component.contextKey === contextKey) {
          this.components.delete(id);
          this.warnedTypeMessages.delete(id);
          this.warnedCallbackMessages.delete(id);
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
  private addCallback(
    messageId: string,
    token: symbol,
    callback: (patch: Record<string, unknown>) => void,
  ) {
    let callbacks = this.callbackMap.get(messageId);
    if (!callbacks) {
      callbacks = new Map();
      this.callbackMap.set(messageId, callbacks);
    }
    callbacks.set(token, callback);
  }

  private getAggregatedCallback(
    messageId: string,
  ): ((patch: Record<string, unknown>) => void) | undefined {
    const callbacks = this.callbackMap.get(messageId);
    if (!callbacks || callbacks.size === 0) {
      return undefined;
    }
    return (patch: Record<string, unknown>) => {
      this.runCallbacks(messageId, patch);
    };
  }

  private runCallbacks(messageId: string, patch: Record<string, unknown>) {
    const callbacks = this.callbackMap.get(messageId);
    if (!callbacks || callbacks.size === 0) {
      return { success: true, invoked: false as const };
    }
    let error: unknown;
    for (const callback of callbacks.values()) {
      try {
        callback(patch);
      } catch (err) {
        console.error(`[ComponentRegistry] Update callback failed for ${messageId}:`, err);
        if (!error) {
          error = err;
        }
      }
    }
    if (error) {
      return {
        success: false,
        error:
          error instanceof Error ? `Update callback failed: ${error.message}` : 'Unknown error',
      };
    }
    return { success: true, invoked: true as const };
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener());
  }
}

// Circuit breaker to prevent infinite update loops
class UpdateCircuitBreaker {
  private recentUpdates = new Map<string, number>();
  private readonly COOLDOWN_MS = 3000; // 3 seconds

  canUpdate(componentId: string, patch: Record<string, unknown>): boolean {
    const key = `${componentId}-${JSON.stringify(patch)}`;
    const lastUpdate = this.recentUpdates.get(key);
    const now = Date.now();

    if (lastUpdate && now - lastUpdate < this.COOLDOWN_MS) {
      console.log(
        `🛑 [CircuitBreaker] Preventing duplicate update for ${componentId} (last update ${now - lastUpdate}ms ago)`,
      );
      return false;
    }

    this.recentUpdates.set(key, now);

    // Clean up old entries
    for (const [updateKey, timestamp] of this.recentUpdates) {
      if (now - timestamp > this.COOLDOWN_MS) {
        this.recentUpdates.delete(updateKey);
      }
    }

    return true;
  }
}

// Global store instance
const componentStore = new ComponentStore();
const updateCircuitBreaker = new UpdateCircuitBreaker();

// Global registry instance for tools to use
export class ComponentRegistry {
  static register(info: ComponentInfo) {
    return componentStore.register(info);
  }

  static async update(messageId: string, patch: Record<string, unknown>) {
    // Check circuit breaker
    if (!updateCircuitBreaker.canUpdate(messageId, patch)) {
      return {
        success: false,
        error:
          '🛑 Update blocked by circuit breaker - identical update too recent. Wait 3 seconds.',
        isCircuitBreakerBlock: true,
      };
    }

    return componentStore.update(messageId, patch);
  }

  static get(messageId: string): ComponentInfo | undefined {
    return componentStore.list().find((c) => c.messageId === messageId);
  }

  static list(contextKey?: string) {
    return componentStore.list(contextKey);
  }

  static remove(messageId: string) {
    componentStore.remove(messageId);
  }

  static release(messageId: string, token: symbol) {
    componentStore.release(messageId, token);
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
  updateCallback?: (patch: Record<string, unknown>) => void,
) {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const registrationTokenRef = React.useRef<symbol | null>(null);

  // Stabilize the updateCallback to prevent infinite loops
  const stableUpdateCallback = React.useCallback(updateCallback || (() => { }), [updateCallback]);

  React.useEffect(() => {
    // Register the component
    const token = ComponentRegistry.register({
      messageId,
      componentType,
      props,
      contextKey,
      timestamp: Date.now(),
      updateCallback: stableUpdateCallback,
    });
    registrationTokenRef.current = token ?? null;

    // Subscribe to changes, but filter out changes for this component to prevent loops
    const unsubscribe = componentStore.subscribe(() => {
      // Only trigger re-render if this component is still registered
      const component = ComponentRegistry.list().find((c) => c.messageId === messageId);
      if (component) {
        forceUpdate();
      }
    });

    return () => {
      // Remove component and unsubscribe
      if (registrationTokenRef.current) {
        ComponentRegistry.release(messageId, registrationTokenRef.current);
        registrationTokenRef.current = null;
      } else {
        ComponentRegistry.remove(messageId);
      }
      unsubscribe();
    };
  }, [messageId, componentType, contextKey]); // Remove updateCallback from deps to prevent loops

  // Update props and callback when they change using silent update (no re-registration logs)
  React.useEffect(() => {
    componentStore.updatePropsOnly(
      messageId,
      props,
      stableUpdateCallback,
      registrationTokenRef.current ?? undefined,
    );
  }, [props, stableUpdateCallback, messageId]);
}

// Simple hook to list components and rerender when they change
export function useComponentList(contextKey?: string) {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    const unsubscribe = componentStore.subscribe(() => {
      forceUpdate();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return ComponentRegistry.list(contextKey);
}
