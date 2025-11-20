/**
 * custom Registry Wrapper
 *
 * HOC that automatically registers custom components with the ComponentRegistry
 * and enables AI updates. This bridges custom's message system with our new
 * simplified component update architecture.
 */
'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { useComponentRegistration } from './component-registry';
/**
 * HOC that wraps a component to automatically register it with ComponentRegistry
 * and enable AI updates
 */
export function withcustomRegistry(Component, componentType, updateHandler) {
    const WrappedComponent = React.forwardRef((props, ref) => {
        const { __custom_message_id, ...componentProps } = props;
        // Local shadow props that can be updated by ComponentRegistry.update(...)
        const [localProps, setLocalProps] = useState({ ...componentProps });
        // Effective props passed down: start from local shadow to allow updates
        const effectiveProps = useMemo(() => ({ ...localProps }), [localProps]);
        // Generate fallback ID if no custom message ID provided
        const effectiveMessageId = __custom_message_id || `${componentType.toLowerCase()}-${Date.now()}`;
        // Default update handler - merge patch into props
        const defaultUpdateHandler = useCallback((patch) => {
            try {
                // If consumer provided a custom handler, let it transform the props first
                if (updateHandler) {
                    const updates = updateHandler(effectiveProps, patch);
                    setLocalProps((prev) => ({ ...prev, ...updates }));
                    return;
                }
                // Default: shallow merge patch into local shadow props
                setLocalProps((prev) => ({ ...prev, ...patch }));
            }
            catch (e) {
                console.warn(`[${componentType}] update handler failed`, e);
            }
        }, [effectiveProps, updateHandler]);
        // Register with ComponentRegistry
        useComponentRegistration(effectiveMessageId, componentType, componentProps, 'default', // context key
        defaultUpdateHandler);
        // Render the original component with effective props
        return <Component ref={ref} {...effectiveProps}/>;
    });
    WrappedComponent.displayName = `withcustomRegistry(${Component.displayName || Component.name || componentType})`;
    return WrappedComponent;
}
/**
 * Factory function to create registry-enabled components
 */
export function createcustomRegistryComponent(Component, componentType, updateHandler) {
    return withcustomRegistry(Component, componentType, updateHandler);
}
/**
 * Utility to inject message ID into component props when rendered by custom
 * This will be called by the message rendering system
 */
export function injectcustomMessageId(Component, messageId) {
    return function ComponentWithMessageId(props) {
        const extendedProps = {
            ...props,
            __custom_message_id: messageId,
        };
        return <Component {...extendedProps}/>;
    };
}
/**
 * Hook to get the current custom message ID from context
 * Useful for components that need to know their own message ID
 */
export function usecustomMessageId() {
    const [messageId, setMessageId] = React.useState(undefined);
    React.useEffect(() => {
        // Check if we're in a custom render context
        if (typeof window !== 'undefined') {
            const customMessageId = window.__CURRENT_custom_MESSAGE_ID__;
            if (customMessageId) {
                setMessageId(customMessageId);
            }
        }
    }, []);
    return messageId;
}
//# sourceMappingURL=custom-registry-wrapper.js.map