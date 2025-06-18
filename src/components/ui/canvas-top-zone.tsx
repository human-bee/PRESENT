/**
 * CanvasTopZone Component
 * 
 * This component serves as the top zone of the canvas, containing
 * the MCP configuration button and status indicator.
 */

"use client";

import { McpConfigButton } from "./mcp-config-button";
import { McpStatusIndicator } from "./mcp-status-indicator";

export function CanvasTopZone() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {/* MCP Config Button */}
      <McpConfigButton />
      
      {/* MCP Status Indicator */}
      <McpStatusIndicator showDetails={false} />
      
      {/* Add other top-level controls here as needed */}
    </div>
  );
} 