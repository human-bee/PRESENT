/**
 * CanvasTopZone Component
 *
 * This component serves as the top zone of the canvas, containing
 * the MCP configuration button and status indicator.
 */

'use client';

import { useEffect, useState } from 'react';
import { McpConfigButton } from '@/components/ui/mcp/mcp-config-button';
import { McpStatusIndicator } from '@/components/ui/mcp/mcp-status-indicator';

type FlowchartErrorBannerState = {
  errorText: string;
  fallbackTriggered: boolean;
  timestamp: number;
};

export function CanvasTopZone() {
  const [flowchartError, setFlowchartError] = useState<FlowchartErrorBannerState | null>(null);

  useEffect(() => {
    const handleError = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const errorText =
        typeof detail?.error === 'string' && detail.error.trim().length > 0
          ? detail.error.trim()
          : 'Mermaid render failed';
      setFlowchartError({
        errorText,
        fallbackTriggered: false,
        timestamp: Date.now(),
      });
    };

    const handleFallback = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const errorText =
        typeof detail?.error === 'string' && detail.error.trim().length > 0
          ? detail.error.trim()
          : flowchartError?.errorText || 'Mermaid render failed';
      setFlowchartError({
        errorText,
        fallbackTriggered: true,
        timestamp: Date.now(),
      });
    };

    const handleOk = () => {
      setFlowchartError(null);
    };

    window.addEventListener('present:mermaid-error', handleError as EventListener);
    window.addEventListener('present:flowchart-fallback', handleFallback as EventListener);
    window.addEventListener('present:mermaid-ok', handleOk as EventListener);

    return () => {
      window.removeEventListener('present:mermaid-error', handleError as EventListener);
      window.removeEventListener('present:flowchart-fallback', handleFallback as EventListener);
      window.removeEventListener('present:mermaid-ok', handleOk as EventListener);
    };
  }, [flowchartError?.errorText]);

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {/* MCP Config Button */}
      <McpConfigButton />

      {/* MCP Status Indicator */}
      <McpStatusIndicator showDetails={false} />

      <div className="flex-1" />

      {flowchartError && (
        <div className="ml-auto flex max-w-md items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive">
          <span className="truncate">
            Flowchart syntax error: {flowchartError.errorText}
            {flowchartError.fallbackTriggered ? ' — retrying with GPT-5-mini…' : ''}
          </span>
          <button
            type="button"
            onClick={() => setFlowchartError(null)}
            className="text-destructive/80 transition hover:text-destructive"
            title="Dismiss error banner"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
