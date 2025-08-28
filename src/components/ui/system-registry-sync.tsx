/**
 * System Registry Sync Component
 *
 * This component runs in the background to sync Tambo components
 * and MCP tools to the centralized System Registry.
 */

'use client';

import { useEffect } from 'react';
import { useTambo } from '@tambo-ai/react';
import { systemRegistry, syncTamboComponentsToRegistry } from '@/lib/system-registry';
import { createLogger } from '@/lib/utils';

const logger = createLogger('SystemRegistrySync');

export function SystemRegistrySync() {
  const { componentList } = useTambo();

  // Sync Tambo components to registry
  useEffect(() => {
    // Primary path: use components discovered by TamboProvider
    if (componentList && componentList.length > 0) {
      const componentInfo = componentList.map((comp) => ({
        name: comp.name,
        description: comp.description || `${comp.name} component`,
      }));
      logger.log(
        '🔄 Syncing Tambo components to system registry:',
        componentInfo.length,
        'components',
      );
      syncTamboComponentsToRegistry(componentInfo);
      return;
    }

    // Fallback: if Tambo hasn't exposed componentList yet, use our local registry
    import('@/lib/tambo')
      .then(({ components }) => {
        if (!components || components.length === 0) return;
        const componentInfo = components.map((comp: any) => ({
          name: comp.name,
          description: comp.description || `${comp.name} component`,
        }));
        logger.log(
          '🔄 [Fallback] Syncing components from local registry:',
          componentInfo.length,
          'components',
        );
        syncTamboComponentsToRegistry(componentInfo);
      })
      .catch(() => {});
  }, [componentList]);

  // Log registry state in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const logRegistryState = () => {
        const capabilities = systemRegistry.getAllCapabilities();
        logger.log('📊 System Registry State:', {
          total: capabilities.length,
          tools: capabilities.filter((c) => c.type === 'tool').length,
          components: capabilities.filter((c) => c.type === 'component').length,
          mcpTools: capabilities.filter((c) => c.type === 'mcp_tool').length,
          available: capabilities.filter((c) => c.available).length,
        });
      };

      // Log initially and on changes
      logRegistryState();
      const unsubscribe = systemRegistry.subscribe(logRegistryState);

      return unsubscribe;
    }
  }, []);

  return null; // This is a background sync component
}
