'use client';

import { useState, useEffect } from 'react';
import { getMcpServerStatuses, loadMcpServers, type McpServer } from '@/lib/mcp-utils';
import { Button } from '@/components/ui/button';

interface McpDebugPanelProps {
  className?: string;
}

export function McpDebugPanel({ className }: McpDebugPanelProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [statuses, setStatuses] = useState(new Map());
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const mcpServers = loadMcpServers();
    const serverStatuses = getMcpServerStatuses();
    setServers(mcpServers);
    setStatuses(serverStatuses);
  }, []);

  const clearFailedServers = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mcp-server-failures');
      const serverStatuses = getMcpServerStatuses();
      setStatuses(serverStatuses);
    }
  };

  const clearAllMcpServers = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mcp-servers');
      localStorage.removeItem('mcp-server-failures');
      setServers([]);
      setStatuses(new Map());
    }
  };

  if (!isExpanded) {
    return (
      <div className={`fixed bottom-4 right-4 ${className}`}>
        <Button
          onClick={() => setIsExpanded(true)}
          variant="outline"
          size="sm"
          className="bg-white shadow-lg"
        >
          🔧 MCP Debug
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`fixed bottom-4 right-4 w-80 bg-white border rounded-lg shadow-lg p-4 z-50 ${className}`}
    >
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-sm">MCP Debug Panel</h3>
        <Button
          onClick={() => setIsExpanded(false)}
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
        >
          ✕
        </Button>
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <div className="font-medium text-gray-700 mb-1">Configured Servers: {servers.length}</div>
          {servers.length === 0 ? (
            <div className="text-gray-500 italic">No MCP servers configured</div>
          ) : (
            <div className="space-y-1">
              {servers.map((server, index) => {
                const url = typeof server === 'string' ? server : server.url;
                const status = statuses.get(url);

                return (
                  <div key={index} className="flex items-center gap-2 text-xs">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        status?.status === 'failed'
                          ? 'bg-red-500'
                          : status?.status === 'connected'
                            ? 'bg-green-500'
                            : 'bg-gray-400'
                      }`}
                    />
                    <div className="flex-1 truncate" title={url}>
                      {url.split('/').pop() || url}
                    </div>
                    {status?.status === 'failed' && (
                      <div className="text-red-600 text-xs">Failed</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t pt-3 space-y-2">
          <Button
            onClick={clearFailedServers}
            variant="outline"
            size="sm"
            className="w-full text-xs h-7"
          >
            Clear Failed Status
          </Button>
          <Button
            onClick={clearAllMcpServers}
            variant="outline"
            size="sm"
            className="w-full text-xs h-7 text-red-600 border-red-200 hover:bg-red-50"
          >
            Clear All MCP Servers
          </Button>
        </div>

        <div className="text-xs text-gray-500 border-t pt-2">
          If you're seeing "Transport is closed" errors, try clearing failed servers or removing
          problematic MCP servers.
        </div>
      </div>
    </div>
  );
}
