/**
 * Tambo Registry Wrapper
 * 
 * HOC that automatically registers Tambo components with the ComponentRegistry
 * and enables AI updates. This bridges Tambo's message system with our new
 * simplified component update architecture.
 */

'use client';

import React, { useCallback } from 'react';
import { useComponentRegistration } from './component-registry';

// Extended props interface that includes Tambo message ID
export interface TamboRegistryProps {
  __tambo_message_id?: string;
  [key: string]: unknown;
}

/**
 * HOC that wraps a component to automatically register it with ComponentRegistry
 * and enable AI updates
 */
export function withTamboRegistry<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  componentType: string,
  updateHandler?: (props: P, patch: Record<string, unknown>) => Partial<P>
) {
  const WrappedComponent = React.forwardRef<unknown, P & TamboRegistryProps>((props, ref) => {
    const { __tambo_message_id, ...componentProps } = props;
    
    // Generate fallback ID if no Tambo message ID provided
    const effectiveMessageId = __tambo_message_id || `${componentType.toLowerCase()}-${Date.now()}`;
    
    // Default update handler - merge patch into props
    const defaultUpdateHandler = useCallback((patch: Record<string, unknown>) => {
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
    }, [componentProps]);
    
    // Register with ComponentRegistry
    useComponentRegistration(
      effectiveMessageId,
      componentType,
      componentProps,
      'default', // context key
      defaultUpdateHandler
    );
    
    // Render the original component
    return <Component ref={ref} {...(componentProps as P)} />;
  });
  
  WrappedComponent.displayName = `withTamboRegistry(${Component.displayName || Component.name || componentType})`;
  
  return WrappedComponent;
}

/**
 * Factory function to create registry-enabled components
 */
export function createTamboRegistryComponent<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  componentType: string,
  updateHandler?: (props: P, patch: Record<string, unknown>) => Partial<P>
) {
  return withTamboRegistry(Component, componentType, updateHandler);
}

/**
 * Utility to inject message ID into component props when rendered by Tambo
 * This will be called by the message rendering system
 */
export function injectTamboMessageId<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  messageId: string
): React.ComponentType<P> {
  return function ComponentWithMessageId(props: P) {
    const extendedProps = {
      ...props,
      __tambo_message_id: messageId,
    } as P & TamboRegistryProps;
    
    return <Component {...extendedProps} />;
  };
}

/**
 * Hook to get the current Tambo message ID from context
 * Useful for components that need to know their own message ID
 */
export function useTamboMessageId(): string | undefined {
  const [messageId, setMessageId] = React.useState<string | undefined>(undefined);
  
  React.useEffect(() => {
    // Check if we're in a Tambo render context
    if (typeof window !== 'undefined') {
      const tamboMessageId = (window as any).__CURRENT_TAMBO_MESSAGE_ID__;
      if (tamboMessageId) {
        setMessageId(tamboMessageId);
      }
    }
  }, []);
  
  return messageId;
} 