'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getMcpServerStatuses } from '@/lib/mcp-utils';

export const McpConfigButton = () => {
  // Load MCP server configurations from localStorage
  const [mcpServerCount, setMcpServerCount] = useState<number>(0);
  const [connectedCount, setConnectedCount] = useState<number>(0);
  const [hasFailures, setHasFailures] = useState<boolean>(false);

  useEffect(() => {
    const updateStatus = () => {
      // Only run in browser environment
      if (typeof window !== 'undefined') {
        const savedServers = localStorage.getItem('mcp-servers');
        if (savedServers) {
          try {
            const servers = JSON.parse(savedServers);
            setMcpServerCount(servers.length);
          } catch (e) {
            console.error('Failed to parse saved MCP servers', e);
          }
        }

        // Get connection status
        const statuses = getMcpServerStatuses();
        const statusArray = Array.from(statuses.values());
        const connected = statusArray.filter((s) => s.status === 'connected').length;
        const failed = statusArray.filter(
          (s) => s.status === 'failed' || s.status === 'disabled',
        ).length;

        setConnectedCount(connected);
        setHasFailures(failed > 0);
      }
    };

    updateStatus();
    // Update status every 30 seconds
    const interval = setInterval(updateStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIndicator = () => {
    if (mcpServerCount === 0) return null;

    if (hasFailures) {
      return (
        <span className="flex items-center justify-center bg-red-500 text-white text-xs rounded-full w-5 h-5 ml-1">
          !
        </span>
      );
    }

    if (connectedCount > 0) {
      return (
        <span className="flex items-center justify-center bg-green-500 text-white text-xs rounded-full w-5 h-5 ml-1">
          {connectedCount}
        </span>
      );
    }

    return (
      <span className="flex items-center justify-center bg-yellow-500 text-white text-xs rounded-full w-5 h-5 ml-1">
        {mcpServerCount}
      </span>
    );
  };

  return (
    <div className="absolute top-2 right-2 z-10">
      <Link
        href="/mcp-config"
        className={`flex items-center gap-1 px-3 py-1.5 text-white text-sm rounded-full hover:opacity-80 ${
          hasFailures ? 'bg-red-600' : 'bg-gray-800 hover:bg-gray-700'
        }`}
        title={`MCP Servers: ${connectedCount}/${mcpServerCount} connected${hasFailures ? ' (some failed)' : ''}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
        <span>MCP</span>
        {getStatusIndicator()}
      </Link>
    </div>
  );
};
