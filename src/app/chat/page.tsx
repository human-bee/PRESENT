"use client";

// Force client-side rendering to prevent SSG issues with Tambo hooks


import { McpConfigButton } from "@/components/ui/mcp-config-button";
import { McpStatusIndicator } from "@/components/ui/mcp-status-indicator";
import { McpDebugPanel } from "@/components/ui/mcp-debug-panel";
import { MessageThreadFull } from "@/components/ui/message-thread-full";
import { loadMcpServers, suppressDevelopmentWarnings, setupGlobalMcpErrorHandler } from "@/lib/mcp-utils";
import { components } from "@/lib/tambo";
import { TamboProvider } from "@tambo-ai/react";
import { EnhancedMcpProvider } from "@/components/ui/enhanced-mcp-provider";
import { useEffect } from "react";

// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();

export default function Home() {
  // Load MCP server configurations
  const mcpServers = loadMcpServers();
  const enableMcp = process.env.NEXT_PUBLIC_ENABLE_MCP_IN_CHAT === 'true';
  
  // Setup global MCP error handler
  useEffect(() => {
    const cleanup = setupGlobalMcpErrorHandler();
    return cleanup;
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* MCP Config Button */}
      <McpConfigButton />
      
      {/* MCP Status Indicator */}
      <div className="absolute top-16 right-4 z-10">
        <McpStatusIndicator showDetails={false} />
      </div>

      {/* MCP Debug Panel */}
      <McpDebugPanel />

      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={components}
        tools={[]}
      >
        {enableMcp ? (
          <EnhancedMcpProvider mcpServers={mcpServers}>
            <div className="flex-1 overflow-hidden">
              <MessageThreadFull contextKey="tambo-template" />
            </div>
          </EnhancedMcpProvider>
        ) : (
          <div className="flex-1 overflow-hidden">
            <MessageThreadFull contextKey="tambo-template" />
          </div>
        )}
      </TamboProvider>
    </div>
  );
}
