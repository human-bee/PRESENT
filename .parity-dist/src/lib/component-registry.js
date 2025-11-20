/**
 * Simple Component Registry for custom
 *
 * Instead of complex bus systems, use direct React patterns for component management.
 * This provides a single source of truth for all UI components across contexts.
 */
import React from 'react';
import { applyComponentOps } from '@/lib/component-reducers';
import { clearOps, filterNewOps, recordOps } from '@/lib/component-crdt';
const cloneValue = (value) => {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
};
const toFiniteNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed)
            return undefined;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
};
const extractVersion = (value) => {
    if (!value)
        return undefined;
    return (toFiniteNumber(value.version) ??
        toFiniteNumber(value._version) ??
        toFiniteNumber(value.__version));
};
const extractTimestamp = (value) => {
    if (!value)
        return undefined;
    return (toFiniteNumber(value.lastUpdated) ??
        toFiniteNumber(value.updatedAt) ??
        toFiniteNumber(value.timestamp));
};
const shouldAcceptUpdate = (existingVersion, existingTimestamp, incomingVersion, incomingTimestamp) => {
    if (incomingVersion == null && incomingTimestamp == null) {
        return true;
    }
    if (incomingVersion != null) {
        if (existingVersion == null)
            return true;
        if (incomingVersion > existingVersion)
            return true;
        if (incomingVersion < existingVersion)
            return false;
        // versions equal
        if (incomingTimestamp != null && existingTimestamp != null) {
            return incomingTimestamp >= existingTimestamp;
        }
        return true;
    }
    if (incomingTimestamp != null && existingTimestamp != null) {
        return incomingTimestamp >= existingTimestamp;
    }
    return true;
};
const mergeState = (base, patch, replace = false) => {
    if (replace) {
        return cloneValue(patch);
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            result[key] = value.slice();
            continue;
        }
        if (value && typeof value === 'object') {
            const existing = result[key];
            if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
                result[key] = mergeState(existing, value);
            }
            else {
                result[key] = { ...value };
            }
            continue;
        }
        result[key] = value;
    }
    return result;
};
const LOGS = typeof process !== 'undefined' &&
    !!(process.env && process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true');
const isDevEnvironment = !(typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'production');
// Utility to compute shallow diff of two objects
function diffProps(oldProps, newProps) {
    const diffs = [];
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
    constructor() {
        this.components = new Map();
        this.listeners = new Set();
        this.warnedTypeMessages = new Set();
        this.warnedCallbackMessages = new Set();
        this.callbackMap = new Map();
        this.registrationCounts = new Map();
    }
    register(info) {
        const existing = this.components.get(info.messageId);
        if (existing &&
            isDevEnvironment &&
            typeof console !== 'undefined' &&
            existing.componentType !== info.componentType &&
            !this.warnedTypeMessages.has(info.messageId)) {
            const warning = {
                messageId: info.messageId,
                previousType: existing.componentType,
                nextType: info.componentType,
            };
            try {
                if (LOGS)
                    console.warn('⚠️ [ComponentRegistry] Duplicate registration detected', warning);
            }
            catch { }
            this.warnedTypeMessages.add(info.messageId);
        }
        const incomingProps = cloneValue(info.props ?? {});
        const incomingVersion = extractVersion(incomingProps);
        const incomingTimestamp = extractTimestamp(incomingProps) ?? Date.now();
        const token = Symbol(info.messageId);
        if (info.updateCallback) {
            this.addCallback(info.messageId, token, info.updateCallback);
        }
        const aggregatedCallback = this.getAggregatedCallback(info.messageId) ?? info.updateCallback;
        let record;
        if (existing) {
            const accept = shouldAcceptUpdate(existing.version, existing.lastUpdated, incomingVersion, incomingTimestamp);
            const nextProps = accept ? mergeState(existing.props, incomingProps) : existing.props;
            record = {
                ...existing,
                componentType: info.componentType || existing.componentType,
                contextKey: info.contextKey ?? existing.contextKey,
                props: nextProps,
                version: accept ? incomingVersion ?? existing.version ?? null : existing.version ?? null,
                lastUpdated: accept ? incomingTimestamp ?? existing.lastUpdated ?? null : existing.lastUpdated ?? null,
                timestamp: Date.now(),
                updateCallback: aggregatedCallback ?? existing.updateCallback,
                originalProps: existing.originalProps ?? cloneValue(existing.props),
                diffHistory: [
                    ...(existing.diffHistory ?? []),
                    ...diffProps(existing.props, nextProps),
                ],
            };
        }
        else {
            record = {
                messageId: info.messageId,
                componentType: info.componentType,
                props: incomingProps,
                version: incomingVersion ?? null,
                lastUpdated: incomingTimestamp ?? null,
                contextKey: info.contextKey,
                timestamp: Date.now(),
                updateCallback: aggregatedCallback,
                originalProps: cloneValue(incomingProps),
                diffHistory: [],
            };
        }
        this.components.set(info.messageId, record);
        const count = (this.registrationCounts.get(info.messageId) ?? 0) + 1;
        this.registrationCounts.set(info.messageId, count);
        if (LOGS) {
            try {
                console.log(`🧩 [ComponentRegistry] Registered ${info.componentType} at ${info.messageId}`);
                console.log(`🧩 [ComponentRegistry] Total components: ${this.components.size}`);
            }
            catch { }
        }
        this.notifyListeners();
        return token;
    }
    // Silent update that doesn't log registration message (for props updates)
    updatePropsOnly(messageId, props, updateCallback, registrationToken) {
        const component = this.components.get(messageId);
        if (component) {
            const incomingProps = cloneValue(props ?? {});
            const incomingVersion = extractVersion(incomingProps);
            const incomingTimestamp = extractTimestamp(incomingProps) ?? Date.now();
            if (updateCallback &&
                component.updateCallback &&
                component.updateCallback !== updateCallback &&
                isDevEnvironment &&
                typeof console !== 'undefined' &&
                !this.warnedCallbackMessages.has(messageId)) {
                try {
                    if (LOGS)
                        console.warn('⚠️ [ComponentRegistry] Update callback replaced via updatePropsOnly', {
                            messageId,
                            previousCallback: component.updateCallback?.name || 'anonymous',
                            nextCallback: updateCallback?.name || 'anonymous',
                        });
                }
                catch { }
                this.warnedCallbackMessages.add(messageId);
            }
            // If caller provides a registrationToken, ensure callback map is updated
            if (registrationToken && updateCallback) {
                this.addCallback(messageId, registrationToken, updateCallback);
            }
            const aggregatedCallback = this.getAggregatedCallback(messageId) ?? updateCallback;
            const accept = shouldAcceptUpdate(component.version, component.lastUpdated, incomingVersion, incomingTimestamp);
            const nextProps = accept ? mergeState(component.props, incomingProps) : component.props;
            const updatedComponent = {
                ...component,
                props: nextProps,
                version: accept ? incomingVersion ?? component.version ?? null : component.version ?? null,
                lastUpdated: accept ? incomingTimestamp ?? component.lastUpdated ?? null : component.lastUpdated ?? null,
                updateCallback: aggregatedCallback,
                timestamp: Date.now(),
                diffHistory: [
                    ...(component.diffHistory ?? []),
                    ...diffProps(component.props, nextProps),
                ],
            };
            this.components.set(messageId, updatedComponent);
            // Silent props refresh to avoid extra renders; listeners notified by state-changing updates
        }
    }
    async update(messageId, patch, options = {}) {
        const component = this.components.get(messageId);
        if (!component) {
            return {
                success: false,
                error: `Component ${messageId} not found. Available: ${Array.from(this.components.keys()).join(', ')}`,
            };
        }
        const incomingVersion = options.version ?? toFiniteNumber(patch.version) ?? component.version ?? null;
        const incomingTimestamp = options.timestamp ??
            toFiniteNumber(patch?.lastUpdated) ??
            toFiniteNumber(patch?.updatedAt) ??
            Date.now();
        const accept = shouldAcceptUpdate(component.version, component.lastUpdated, incomingVersion, incomingTimestamp);
        if (!accept) {
            if (LOGS)
                console.log(`[ComponentRegistry] Ignored update for ${messageId} (older version/timestamp)`, {
                    incomingVersion,
                    incomingTimestamp,
                    existingVersion: component.version,
                    existingTimestamp: component.lastUpdated,
                });
            return { success: true, ignored: true };
        }
        const rawOps = Array.isArray(patch?._ops) ? patch._ops : [];
        const dedupedOps = rawOps.length
            ? filterNewOps(component.messageId, rawOps, { version: incomingVersion ?? null, timestamp: incomingTimestamp ?? null })
            : [];
        const sanitizedPatch = { ...cloneValue(patch) };
        if ('_ops' in sanitizedPatch) {
            delete sanitizedPatch._ops;
        }
        const stateAfterOps = dedupedOps.length
            ? applyComponentOps(component.componentType, component.props, dedupedOps)
            : component.props;
        const mergedProps = mergeState(stateAfterOps, sanitizedPatch, options.replace === true);
        // Compute diffs
        const propDiffs = diffProps(component.props, mergedProps);
        const updatedComponent = {
            ...component,
            props: mergedProps,
            version: incomingVersion,
            lastUpdated: incomingTimestamp,
            timestamp: Date.now(),
            originalProps: component.originalProps || component.props,
            diffHistory: [...(component.diffHistory || []), ...propDiffs],
        };
        if (dedupedOps.length) {
            recordOps(component.messageId, dedupedOps, {
                version: incomingVersion ?? null,
                timestamp: incomingTimestamp ?? null,
            });
        }
        updatedComponent.updateCallback = this.getAggregatedCallback(messageId);
        this.components.set(messageId, updatedComponent);
        const callbackPayload = {
            ...sanitizedPatch,
            __mergedProps: mergedProps,
            __version: incomingVersion,
            __timestamp: incomingTimestamp,
        };
        const callbackResult = this.runCallbacks(messageId, callbackPayload);
        if (!callbackResult.success) {
            return callbackResult;
        }
        if (LOGS)
            console.log(`[ComponentRegistry] Updated ${messageId} props${callbackResult.invoked ? '' : ' (no callback)'}`);
        this.notifyListeners();
        return { success: true };
    }
    list(contextKey) {
        const components = Array.from(this.components.values());
        if (!contextKey)
            return components;
        return components.filter((c) => c.contextKey === contextKey);
    }
    remove(messageId) {
        this.components.delete(messageId);
        this.warnedTypeMessages.delete(messageId);
        this.warnedCallbackMessages.delete(messageId);
        clearOps(messageId);
        if (LOGS)
            console.log(`[ComponentRegistry] Removed ${messageId}`);
        this.notifyListeners();
    }
    release(messageId, token) {
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
                if (LOGS)
                    console.log(`[ComponentRegistry] Removed ${messageId}`);
                clearOps(messageId);
                this.notifyListeners();
                return;
            }
            this.registrationCounts.set(messageId, nextCount);
        }
        const component = this.components.get(messageId);
        if (component) {
            const aggregatedCallback = this.getAggregatedCallback(messageId);
            const updatedComponent = {
                ...component,
                updateCallback: aggregatedCallback,
                timestamp: Date.now(),
            };
            this.components.set(messageId, updatedComponent);
            this.notifyListeners();
        }
    }
    clear(contextKey) {
        if (!contextKey) {
            this.components.clear();
            this.callbackMap.clear();
            this.registrationCounts.clear();
            clearOps();
            if (LOGS)
                console.log(`[ComponentRegistry] Cleared all components`);
        }
        else {
            for (const [id, component] of this.components) {
                if (component.contextKey === contextKey) {
                    this.components.delete(id);
                    this.warnedTypeMessages.delete(id);
                    this.warnedCallbackMessages.delete(id);
                    clearOps(id);
                }
            }
            if (LOGS)
                console.log(`[ComponentRegistry] Cleared components for context: ${contextKey}`);
        }
        this.notifyListeners();
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    addCallback(messageId, token, callback) {
        let callbacks = this.callbackMap.get(messageId);
        if (!callbacks) {
            callbacks = new Map();
            this.callbackMap.set(messageId, callbacks);
        }
        callbacks.set(token, callback);
    }
    getAggregatedCallback(messageId) {
        const callbacks = this.callbackMap.get(messageId);
        if (!callbacks || callbacks.size === 0) {
            return undefined;
        }
        return (patch) => {
            this.runCallbacks(messageId, patch);
        };
    }
    runCallbacks(messageId, patch) {
        const callbacks = this.callbackMap.get(messageId);
        if (!callbacks || callbacks.size === 0) {
            return { success: true, invoked: false };
        }
        let error;
        for (const callback of callbacks.values()) {
            try {
                callback(patch);
            }
            catch (err) {
                console.error(`[ComponentRegistry] Update callback failed for ${messageId}:`, err);
                if (!error) {
                    error = err;
                }
            }
        }
        if (error) {
            return {
                success: false,
                error: error instanceof Error ? `Update callback failed: ${error.message}` : 'Unknown error',
            };
        }
        return { success: true, invoked: true };
    }
    notifyListeners() {
        this.listeners.forEach((listener) => listener());
    }
}
// Circuit breaker to prevent infinite update loops
class UpdateCircuitBreaker {
    constructor() {
        this.recentUpdates = new Map();
        this.COOLDOWN_MS = 3000; // 3 seconds
    }
    canUpdate(componentId, patch) {
        const key = `${componentId}-${JSON.stringify(patch)}`;
        const lastUpdate = this.recentUpdates.get(key);
        const now = Date.now();
        if (lastUpdate && now - lastUpdate < this.COOLDOWN_MS) {
            if (LOGS) {
                console.log(`🛑 [CircuitBreaker] Preventing duplicate update for ${componentId} (last update ${now - lastUpdate}ms ago)`);
            }
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
    static register(info) {
        return componentStore.register(info);
    }
    static async update(messageId, patch, options = {}) {
        // Check circuit breaker
        if (!updateCircuitBreaker.canUpdate(messageId, patch)) {
            return {
                success: false,
                error: '🛑 Update blocked by circuit breaker - identical update too recent. Wait 3 seconds.',
                isCircuitBreakerBlock: true,
            };
        }
        return componentStore.update(messageId, patch, options);
    }
    static get(messageId) {
        return componentStore.list().find((c) => c.messageId === messageId);
    }
    static list(contextKey) {
        return componentStore.list(contextKey);
    }
    static remove(messageId) {
        componentStore.remove(messageId);
    }
    static release(messageId, token) {
        componentStore.release(messageId, token);
    }
    static clear(contextKey) {
        componentStore.clear(contextKey);
    }
}
// Hook for components to register themselves and listen to updates
export function useComponentRegistration(messageId, componentType, props, contextKey, updateCallback) {
    const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
    const registrationTokenRef = React.useRef(null);
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
            }
            else {
                ComponentRegistry.remove(messageId);
            }
            unsubscribe();
        };
    }, [messageId, componentType, contextKey]); // Remove updateCallback from deps to prevent loops
    // Update props and callback when they change using silent update (no re-registration logs)
    React.useEffect(() => {
        componentStore.updatePropsOnly(messageId, props, stableUpdateCallback, registrationTokenRef.current ?? undefined);
    }, [props, stableUpdateCallback, messageId]);
}
// Simple hook to list components and rerender when they change
export function useComponentList(contextKey) {
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
//# sourceMappingURL=component-registry.js.map