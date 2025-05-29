"use client";

import { CanvasSpace } from "@/components/ui/canvas-space";
import { McpConfigButton } from "@/components/ui/mcp-config-button";
import { MessageThreadCollapsible } from "@/components/ui/message-thread-collapsible";
import { loadMcpServers } from "@/lib/mcp-utils";
import { components } from "@/lib/tambo";
import { TamboProvider } from "@tambo-ai/react";
import { TamboMcpProvider } from "@tambo-ai/react/mcp";

export default function Canvas() {
  // Load MCP server configurations
  const mcpServers = loadMcpServers();
  const contextKey = "tambo-canvas";

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      {/* MCP Config Button - positioned at top left */}
      <McpConfigButton />

      {/* Tambo Provider Setup */}
      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={components}
      >
        <TamboMcpProvider mcpServers={mcpServers}>
          {/* Full-screen Canvas Space */}
          <CanvasSpace className="absolute inset-0 w-full h-full" />

          {/* Collapsible Message Thread - positioned bottom right as overlay */}
          <MessageThreadCollapsible
            contextKey={contextKey}
            defaultOpen={false}
            className="absolute bottom-4 right-4 z-50"
            variant="default"
          />
        </TamboMcpProvider>
      </TamboProvider>
    </div>
  );
}
