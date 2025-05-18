"use client";
import { useEffect } from "react";
import { McpConfigButton } from "@/components/ui/mcp-config-button";
import { MessageThreadFull } from "@/components/ui/message-thread-full";
import { loadMcpServers } from "@/lib/mcp-utils";
import { components, tools } from "@/lib/tambo";
import { TamboProvider, useTambo } from "@tambo-ai/react";
import { TamboMcpProvider } from "@tambo-ai/react/mcp";
import { timerSchema } from "@/components/ui/timer";
import { z } from "zod";

function RegisterTimerTool() {
  const { registerTool } = useTambo();
  useEffect(() => {
    registerTool({
      name: "Timer",
      description: "Start a countdown timer for a specified number of minutes and seconds.",
      tool: async (input: z.infer<typeof timerSchema>) => {
        return input;
      },
      toolSchema: timerSchema,
    });
  }, [registerTool]);
  return null;
}

export default function Home() {
  // Load MCP server configurations
  const mcpServers = loadMcpServers();

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* MCP Config Button */}
      <McpConfigButton />

      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={components}
        tools={tools}
      >
        <RegisterTimerTool />
        <TamboMcpProvider mcpServers={mcpServers}>
          <div className="flex-1 overflow-hidden">
            <MessageThreadFull contextKey="tambo-template" />
          </div>
        </TamboMcpProvider>
      </TamboProvider>
    </div>
  );
}
