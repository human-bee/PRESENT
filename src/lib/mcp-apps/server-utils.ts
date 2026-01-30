'use client';

import { loadMcpServers, type McpServer } from '@/lib/mcp-utils';

const normalize = (value: string) => value.trim();

export type McpServerResolution = {
  server?: McpServer;
  url?: string;
  name?: string;
  transport?: 'sse' | 'http';
};

export function getMcpServerUrl(server?: McpServer): string | undefined {
  if (!server) return undefined;
  return typeof server === 'string' ? server : server.url;
}

export function resolveMcpServer(serverHint?: string): McpServerResolution {
  if (typeof window === 'undefined') return {};
  const servers = loadMcpServers();
  if (!servers.length) return {};

  if (serverHint) {
    const hint = normalize(serverHint);
    const direct = servers.find((server) => {
      if (typeof server === 'string') return normalize(server) === hint;
      return normalize(server.url) === hint || (server.name && normalize(server.name) === hint);
    });
    if (direct) {
      return {
        server: direct,
        url: getMcpServerUrl(direct),
        name: typeof direct === 'string' ? undefined : direct.name,
        transport: typeof direct === 'string' ? undefined : direct.transport,
      };
    }
  }

  const fallback = servers[0];
  return {
    server: fallback,
    url: getMcpServerUrl(fallback),
    name: typeof fallback === 'string' ? undefined : fallback.name,
    transport: typeof fallback === 'string' ? undefined : fallback.transport,
  };
}
