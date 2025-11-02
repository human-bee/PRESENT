/**
 * Enhanced MCP Provider with smart error handling and connection management
 *
 * This component provides enhanced MCP (Model Context Protocol) functionality
 * with smart error handling and connection management.
 *
 * DEVELOPER NOTES:
 * - Handles MCP server connection statuses
 * - Implements automatic retry logic for failed connections
 * - Provides connection status callbacks
 * - Handles manual connection retries
 * - Logs connection events in development mode
 *
 * FEATURES:
 * - Automatic retry logic for failed connections
 * - Connection status callbacks
 * - Manual connection retries
 * - Connection status logging
 */

'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { customMcpProvider } from '@custom-ai/react/mcp';
import {
  markMcpServerFailed,
  markMcpServerConnected,
  getMcpServerStatuses,
  resetMcpServerFailures,
  type McpServer,
} from '@/lib/mcp-utils';
import { sanitizeToolName, isValidToolName } from '@/lib/custom-tool-validator';

interface EnhancedMcpProviderProps {
  children: React.ReactNode;
  mcpServers: McpServer[];
  onConnectionStatus?: (status: { connected: number; failed: number; total: number }) => void;
}

/**
 * Enhanced MCP Provider with smart error handling and connection management
 */
let loggedNoServersOnce = false;

export function EnhancedMcpProvider({
  children,
  mcpServers,
  onConnectionStatus,
}: EnhancedMcpProviderProps) {
  const CustomMcpProvider = useMemo(
    () =>
      customMcpProvider as unknown as React.ComponentType<
        {
          children: React.ReactNode;
          mcpServers?: unknown[];
        }
      >,
    [],
  );
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [lastConnectionTime, setLastConnectionTime] = useState<number>(0);

  // Monitor connection status
  const LOGS = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_TOOL_DISPATCHER_LOGS === 'true';
  const updateConnectionStatus = useCallback(() => {
    const statuses = getMcpServerStatuses();
    const connected = Array.from(statuses.values()).filter((s) => s.status === 'connected').length;
    const failed = Array.from(statuses.values()).filter(
      (s) => s.status === 'failed' || s.status === 'disabled',
    ).length;
    const total = mcpServers.length;

    if (onConnectionStatus) {
      onConnectionStatus({ connected, failed, total });
    }
  }, [mcpServers.length, onConnectionStatus]);

  // Enhanced error boundary for MCP connections
  const handleMcpError = useCallback(
    (error: Error, serverUrl?: string) => {
      if (process.env.NODE_ENV === 'development' && LOGS) {
        console.warn(
          `[Enhanced MCP] Connection error${serverUrl ? ` for ${serverUrl}` : ''}:`,
          error.message,
        );
      }

      if (serverUrl) {
        markMcpServerFailed(serverUrl, error.message);
      }

      updateConnectionStatus();
    },
    [updateConnectionStatus],
  );

  // Handle successful connections
  const handleMcpSuccess = useCallback(
    (serverUrl: string) => {
      if (process.env.NODE_ENV === 'development' && LOGS) {
        console.log(`[Enhanced MCP] Successfully connected to ${serverUrl}`);
      }

      markMcpServerConnected(serverUrl);
      updateConnectionStatus();
    },
    [updateConnectionStatus],
  );

  // Reset connections if we haven't tried in a while (manual refresh)
  useEffect(() => {
    const now = Date.now();
    const timeSinceLastConnection = now - lastConnectionTime;

    // If it's been more than 10 minutes since last connection attempt, reset failures
    if (timeSinceLastConnection > 10 * 60 * 1000 && connectionAttempts > 0) {
      if (process.env.NODE_ENV === 'development' && LOGS) {
        console.log('[Enhanced MCP] Resetting connection failures after 10 minutes');
      }
      resetMcpServerFailures();
      setConnectionAttempts(0);
    }
  }, [connectionAttempts, lastConnectionTime]);

  // Track connection attempts
  useEffect(() => {
    if (mcpServers.length > 0) {
      setConnectionAttempts((prev) => prev + 1);
      setLastConnectionTime(Date.now());
    }
  }, [mcpServers]);

  // Log connection summary
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && LOGS && mcpServers.length > 0) {
      const activeServers = mcpServers.filter((server) => {
        const url = typeof server === 'string' ? server : server.url;
        const statuses = getMcpServerStatuses();
        const status = statuses.get(url);
        return !status || status.status !== 'disabled';
      });

      if (activeServers.length !== mcpServers.length) {
        console.log(
          `[Enhanced MCP] ${activeServers.length}/${mcpServers.length} servers enabled (${mcpServers.length - activeServers.length} disabled due to failures)`,
        );
      }
    }
  }, [mcpServers]);

  // If no servers are available, render children without MCP
  if (mcpServers.length === 0) {
    if (process.env.NODE_ENV === 'development' && LOGS && !loggedNoServersOnce) {
      console.log('[Enhanced MCP] No MCP servers available, rendering without MCP functionality');
      loggedNoServersOnce = true;
    }
    return <>{children}</>;
  }

  return (
    <MCPErrorBoundary onError={handleMcpError}>
      <CustomMcpProvider mcpServers={mcpServers}>{children}</CustomMcpProvider>
    </MCPErrorBoundary>
  );
}

/**
 * Error boundary specifically for MCP provider errors
 */
class MCPErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    onError?: (error: Error) => void;
  },
  { hasError: boolean; error?: Error; retryCount: number }
> {
  private maxRetries = 3;
  private retryTimeout?: NodeJS.Timeout;

  constructor(props: { children: React.ReactNode; onError?: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (process.env.NODE_ENV === 'development' && LOGS) {
      console.warn('[Enhanced MCP] Error boundary caught MCP error:', error);
    }

    if (this.props.onError) {
      this.props.onError(error);
    }

    // Auto-retry after a delay if we haven't exceeded max retries
    if (this.state.retryCount < this.maxRetries) {
      this.retryTimeout = setTimeout(
        () => {
          this.setState((prevState) => ({
            hasError: false,
            error: undefined,
            retryCount: prevState.retryCount + 1,
          }));
        },
        5000 * (this.state.retryCount + 1),
      ); // Exponential backoff
    }
  }

  componentWillUnmount() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }

  handleManualRetry = () => {
    this.setState({
      hasError: false,
      error: undefined,
      retryCount: 0,
    });
  };

  render() {
    if (this.state.hasError) {
      const isMaxRetriesReached = this.state.retryCount >= this.maxRetries;

      return (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="text-yellow-800 font-semibold">MCP Connection Issue</h3>
          <p className="text-yellow-700 text-sm mt-1">
            {isMaxRetriesReached
              ? 'MCP servers are unavailable. The app will continue without external tool functionality.'
              : `Retrying MCP connection... (attempt ${this.state.retryCount + 1}/${this.maxRetries})`}
          </p>
          {isMaxRetriesReached && (
            <button
              onClick={this.handleManualRetry}
              className="mt-2 px-3 py-1 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700"
            >
              Retry Connection
            </button>
          )}
          {/* Render children anyway so the app doesn't break */}
          <div className="mt-3">{this.props.children}</div>
        </div>
      );
    }

    return this.props.children;
  }
}
