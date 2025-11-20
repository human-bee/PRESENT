/**
 * System Registry Sync Component
 *
 * This component runs in the background to sync custom components
 * and MCP tools to the centralized System Registry.
 */

'use client';

import { useEffect } from 'react';
import { usecustom } from '@custom-ai/react';
import { systemRegistry, synccustomComponentsToRegistry, syncMcpToolsToRegistry } from '@/lib/system-registry';
import { createLogger } from '@/lib/utils';

const logger = createLogger('SystemRegistrySync');

const globalSyncState: { fallbackSynced: boolean } = (() => {
  if (typeof globalThis === 'undefined') {
    return { fallbackSynced: false };
  }
  const key = '__presentSystemRegistrySync';
  const existing = (globalThis as any)[key];
  if (existing) return existing;
  const value = { fallbackSynced: false };
  (globalThis as any)[key] = value;
  return value;
})();

export function SystemRegistrySync() {
  const { componentList } = usecustom();

  // Sync custom components to registry
  useEffect(() => {
    // Primary path: use components discovered by customProvider
    if (componentList && componentList.length > 0) {
      const componentInfo = componentList.map((comp) => ({
        name: comp.name,
        description: comp.description || `${comp.name} component`,
      }));
      logger.debug('🔄 Syncing custom components from provider:', componentInfo.length, 'components');
      synccustomComponentsToRegistry(componentInfo);
      return;
    }

    // Fallback: if custom hasn't exposed componentList yet, use our local registry
    if (globalSyncState.fallbackSynced) return;

    import('@/lib/custom')
      .then(({ components }) => {
        if (!components || components.length === 0) return;
        if (globalSyncState.fallbackSynced) return;
        const componentInfo = components.map((comp: any) => ({
          name: comp.name,
          description: comp.description || `${comp.name} component`,
        }));
        logger.debug('🔄 [Fallback] Syncing components from local registry:', componentInfo.length, 'components');
        synccustomComponentsToRegistry(componentInfo);
        globalSyncState.fallbackSynced = true;
      })
      .catch(() => { });
  }, [componentList]);

  // Sync MCP tools (from window bridge) to registry
  useEffect(() => {
    const syncMcp = () => {
      try {
        const tools = (window as any).__custom_mcp_tools || {};
        const list = Object.keys(tools).map((name) => ({ name, description: tools[name]?.description || name }));
        if (list.length > 0) {
          syncMcpToolsToRegistry(list);
        }
      } catch {}
    };
    // Initial sync and on interval (lightweight)
    syncMcp();
    const t = setInterval(syncMcp, 2000);
    return () => clearInterval(t);
  }, []);

  // Log registry state in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      let lastSig: string | null = null;
      const logRegistryState = () => {
        const capabilities = systemRegistry.getAllCapabilities();
        const summary = {
          total: capabilities.length,
          tools: capabilities.filter((c) => c.type === 'tool').length,
          components: capabilities.filter((c) => c.type === 'component').length,
          mcpTools: capabilities.filter((c) => c.type === 'mcp_tool').length,
          available: capabilities.filter((c) => c.available).length,
        };
        const sig = JSON.stringify(summary);
        if (sig !== lastSig) {
          logger.debug('📊 System Registry State:', summary);
          lastSig = sig;
        }
      };

      // Log initially and on changes
      logRegistryState();
      const unsubscribe = systemRegistry.subscribe(logRegistryState);

      return unsubscribe;
    }
  }, []);

  return null; // This is a background sync component
}
