/**
 * custom Registry Wrapper
 *
 * HOC that automatically registers custom components with the ComponentRegistry
 * and enables AI updates. This bridges custom's message system with our new
 * simplified component update architecture.
 */

'use client';

import React, { useCallback } from 'react';
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

    // Generate fallback ID if no custom message ID provided
    const effectiveMessageId = __custom_message_id || `${componentType.toLowerCase()}-${Date.now()}`;

    // Default update handler - merge patch into props
    const defaultUpdateHandler = useCallback(
      (patch: Record<string, unknown>) => {
        console.log(`[${componentType}] Received AI update:`, patch);

        // If custom update handler provided, use it
        if (updateHandler) {
          const updatedProps = updateHandler(componentProps as P, patch);
          // For now, log the would-be update
          // In a full implementation, this would trigger a re-render with new props
          console.log(`[${componentType}] Would update props:`, updatedProps);
          return;
        }

        // Default behavior - this works for components that manage their own state
        // and check props in useEffect dependencies
        console.log(`[${componentType}] Default update - component should handle props change`);
      },
      [componentProps],
    );

    // Register with ComponentRegistry
    useComponentRegistration(
      effectiveMessageId,
      componentType,
      componentProps,
      'default', // context key
      defaultUpdateHandler,
    );

    // Render the original component
    return <Component ref={ref} {...(componentProps as P)} />;
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

