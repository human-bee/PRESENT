/**
 * MCP Activity Indicator
 *
 * Shows which MCP tools are actively fetching data
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2, Activity, CheckCircle, AlertCircle } from 'lucide-react';

export interface MCPActivityProps {
  activities: Record<string, boolean>;
  errors?: Record<string, Error>;
  className?: string;
}

export function MCPActivityIndicator({ activities, errors = {}, className }: MCPActivityProps) {
  const activeTools = Object.entries(activities).filter(([_, active]) => active);
  const hasErrors = Object.keys(errors).length > 0;

  if (activeTools.length === 0 && !hasErrors) return null;

  return (
    <div className={cn('flex items-center space-x-2 text-xs', className)}>
      {activeTools.length > 0 && (
        <div className="flex items-center space-x-1">
          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
          <span className="text-slate-400">{activeTools.map(([tool]) => tool).join(', ')}</span>
        </div>
      )}

      {hasErrors && (
        <div className="flex items-center space-x-1">
          <AlertCircle className="w-3 h-3 text-red-400" />
          <span className="text-red-400">
            {Object.keys(errors).length} error{Object.keys(errors).length > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}

// Floating MCP status panel
export function MCPStatusPanel({
  activities,
  errors = {},
  enrichedData = {},
  className,
}: MCPActivityProps & { enrichedData?: Record<string, any> }) {
  const totalTools = Object.keys(activities).length;
  const activeCount = Object.values(activities).filter(Boolean).length;
  const completedCount = Object.keys(enrichedData).length;

  return (
    <div
      className={cn(
        'absolute top-2 right-2 bg-slate-900/90 backdrop-blur-sm rounded-lg p-3 border border-slate-700',
        'shadow-lg max-w-xs',
        className,
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white">MCP Activity</span>
        </div>
        <span className="text-xs text-slate-400">
          {completedCount}/{totalTools}
        </span>
      </div>

      <div className="space-y-1">
        {Object.entries(activities).map(([tool, active]) => {
          const hasError = errors[tool];
          const hasData = enrichedData[tool];

          return (
            <div key={tool} className="flex items-center justify-between">
              <span className="text-xs text-slate-300 capitalize">{tool}</span>
              <div className="flex items-center space-x-1">
                {active && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
                {!active && hasData && <CheckCircle className="w-3 h-3 text-green-400" />}
                {!active && hasError && <AlertCircle className="w-3 h-3 text-red-400" />}
              </div>
            </div>
          );
        })}
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-700">
          <p className="text-xs text-red-400">Some data sources failed. Using fallback data.</p>
        </div>
      )}
    </div>
  );
}
