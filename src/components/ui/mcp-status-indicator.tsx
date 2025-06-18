"use client";

import React, { useEffect, useState } from 'react';
import { getMcpServerStatuses, resetMcpServerFailures } from '@/lib/mcp-utils';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Clock } from 'lucide-react';

interface McpServerStatus {
  url: string;
  status: 'connecting' | 'connected' | 'failed' | 'disabled';
  lastAttempt: number;
  failureCount: number;
  lastError?: string;
}

interface McpStatusIndicatorProps {
  showDetails?: boolean;
  className?: string;
}

export function McpStatusIndicator({ showDetails = false, className = "" }: McpStatusIndicatorProps) {
  const [statuses, setStatuses] = useState<Map<string, McpServerStatus>>(new Map());
  const [isExpanded, setIsExpanded] = useState(showDetails);

  // Update status every 30 seconds
  useEffect(() => {
    const updateStatuses = () => {
      setStatuses(getMcpServerStatuses());
    };

    updateStatuses();
    const interval = setInterval(updateStatuses, 30000);
    return () => clearInterval(interval);
  }, []);

  const statusArray = Array.from(statuses.values());
  const connected = statusArray.filter(s => s.status === 'connected').length;
  const failed = statusArray.filter(s => s.status === 'failed').length;
  const disabled = statusArray.filter(s => s.status === 'disabled').length;
  const connecting = statusArray.filter(s => s.status === 'connecting').length;
  const total = statusArray.length;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'disabled':
        return <AlertCircle className="w-4 h-4 text-gray-400" />;
      case 'connecting':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-green-600 bg-green-50';
      case 'failed':
        return 'text-red-600 bg-red-50';
      case 'disabled':
        return 'text-gray-600 bg-gray-50';
      case 'connecting':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const handleReset = () => {
    resetMcpServerFailures();
    setTimeout(() => {
      setStatuses(getMcpServerStatuses());
      // Trigger a page reload to retry connections
      window.location.reload();
    }, 100);
  };

  const formatLastAttempt = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (total === 0) {
    return null;
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}>
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            {connected > 0 && <CheckCircle className="w-4 h-4 text-green-500" />}
            {failed > 0 && <XCircle className="w-4 h-4 text-red-500" />}
            {disabled > 0 && <AlertCircle className="w-4 h-4 text-gray-400" />}
            {connecting > 0 && <Clock className="w-4 h-4 text-yellow-500" />}
          </div>
          <span className="text-sm font-medium text-gray-700">
            MCP Servers
          </span>
          <span className="text-xs text-gray-500">
            {connected}/{total} connected
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          {(failed > 0 || disabled > 0) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              className="flex items-center space-x-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
              title="Reset and retry failed connections"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}
          <span className="text-xs text-gray-400">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100">
          {statusArray.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {statusArray.map((status) => (
                <div key={status.url} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      {getStatusIcon(status.status)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {status.url}
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-gray-500">
                          <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(status.status)}`}>
                            {status.status}
                          </span>
                          <span>Last attempt: {formatLastAttempt(status.lastAttempt)}</span>
                          {status.failureCount > 0 && (
                            <span className="text-red-500">
                              {status.failureCount} failures
                            </span>
                          )}
                        </div>
                        {status.lastError && (
                          <div className="text-xs text-red-600 mt-1 truncate" title={status.lastError}>
                            {status.lastError}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 text-sm text-gray-500 text-center">
              No MCP servers configured
            </div>
          )}
        </div>
      )}
    </div>
  );
} 