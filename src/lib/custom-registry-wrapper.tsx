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

// Extended props interface that includes custom message ID
export interface customRegistryProps {
  __custom_message_id?: string;
  [key: string]: unknown;
}

/**
 * HOC that wraps a component to automatically register it with ComponentRegistry
 * and enable AI updates
 */
export function withcustomRegistry<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  componentType: string,
  updateHandler?: (props: P, patch: Record<string, unknown>) => Partial<P>,
) {
  const WrappedComponent = React.forwardRef<unknown, P & customRegistryProps>((props, ref) => {
    const { __custom_message_id, ...componentProps } = props;

    // Local shadow props that can be updated by ComponentRegistry.update(...)
    const [localProps, setLocalProps] = useState<Record<string, unknown>>({ ...componentProps });
    // Effective props passed down: start from local shadow to allow updates
    const effectiveProps = useMemo(() => ({ ...localProps }), [localProps]);

    // Generate fallback ID if no custom message ID provided
    const effectiveMessageId = __custom_message_id || `${componentType.toLowerCase()}-${Date.now()}`;

    // Default update handler - merge patch into props
    const defaultUpdateHandler = useCallback(
      (patch: Record<string, unknown>) => {
        try {
          // If consumer provided a custom handler, let it transform the props first
          if (updateHandler) {
            const updates = updateHandler(effectiveProps as P, patch);
            setLocalProps((prev) => ({ ...prev, ...updates }));
            return;
          }
          // Default: shallow merge patch into local shadow props
          setLocalProps((prev) => ({ ...prev, ...patch }));
        } catch (e) {
          console.warn(`[${componentType}] update handler failed`, e);
        }
      },
      [effectiveProps, updateHandler],
    );

    // Register with ComponentRegistry
    useComponentRegistration(
      effectiveMessageId,
      componentType,
      componentProps,
      'default', // context key
      defaultUpdateHandler,
    );

    // Render the original component with effective props
    return <Component ref={ref} {...(effectiveProps as P)} />;
  });

  WrappedComponent.displayName = `withcustomRegistry(${Component.displayName || Component.name || componentType})`;

  return WrappedComponent;
}

/**
 * Factory function to create registry-enabled components
 */
export function createcustomRegistryComponent<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  componentType: string,
  updateHandler?: (props: P, patch: Record<string, unknown>) => Partial<P>,
) {
  return withcustomRegistry(Component, componentType, updateHandler);
}

/**
 * Utility to inject message ID into component props when rendered by custom
 * This will be called by the message rendering system
 */
export function injectcustomMessageId<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  messageId: string,
): React.ComponentType<P> {
  return function ComponentWithMessageId(props: P) {
    const extendedProps = {
      ...props,
      __custom_message_id: messageId,
    } as P & customRegistryProps;

    return <Component {...extendedProps} />;
  };
}

/**
 * Hook to get the current custom message ID from context
 * Useful for components that need to know their own message ID
 */
export function usecustomMessageId(): string | undefined {
  const [messageId, setMessageId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    // Check if we're in a custom render context
    if (typeof window !== 'undefined') {
      const customMessageId = (window as any).__CURRENT_custom_MESSAGE_ID__;
      if (customMessageId) {
        setMessageId(customMessageId);
      }
    }
  }, []);

  return messageId;
}
