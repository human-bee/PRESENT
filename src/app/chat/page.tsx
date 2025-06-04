"use client";
import { McpConfigButton } from "@/components/ui/mcp-config-button";
import { McpStatusIndicator } from "@/components/ui/mcp-status-indicator";
import { MessageThreadFull } from "@/components/ui/message-thread-full";
import { loadMcpServers, suppressDevelopmentWarnings, suppressViolationWarnings } from "@/lib/mcp-utils";
import { components } from "@/lib/tambo";
import { TamboProvider } from "@tambo-ai/react";
import { EnhancedMcpProvider } from "@/components/ui/enhanced-mcp-provider";

// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();
suppressViolationWarnings();

export default function Home() {
  // Load MCP server configurations
  const mcpServers = loadMcpServers();

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* MCP Config Button */}
      <McpConfigButton />
      
      {/* MCP Status Indicator */}
      <div className="absolute top-16 right-4 z-10">
        <McpStatusIndicator showDetails={false} />
      </div>

      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={components}
      >
        <EnhancedMcpProvider mcpServers={mcpServers}>
          <div className="flex-1 overflow-hidden">
            <MessageThreadFull contextKey="tambo-template" />
          </div>
        </EnhancedMcpProvider>
      </TamboProvider>
    </div>
  );
}
