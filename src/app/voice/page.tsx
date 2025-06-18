"use client";

// Force client-side rendering to prevent SSG issues with Tambo hooks

import { CanvasSpace } from "@/components/ui/canvas-space";
import {
  LiveKitProvider,
  LiveKitUI,
  RpcHandler,
} from "@/components/ui/live-kit";
import { LivekitParticipantSpawner } from "@/components/ui/livekit-participant-spawner";
import { McpConfigButton } from "@/components/ui/mcp-config-button";
import { McpStatusIndicator } from "@/components/ui/mcp-status-indicator";
import { Message, MessageContent } from "@/components/ui/message";
import { ScrollableMessageContainer } from "@/components/ui/scrollable-message-container";
import { ThreadContainer } from "@/components/ui/thread-container";
import { ThreadContent } from "@/components/ui/thread-content";
import { loadMcpServers, suppressDevelopmentWarnings, suppressViolationWarnings } from "@/lib/mcp-utils";
import { components } from "@/lib/tambo";
import { TamboProvider, useTamboThread } from "@tambo-ai/react";
import { EnhancedMcpProvider } from "@/components/ui/enhanced-mcp-provider";
import React from "react";

// Suppress development warnings for cleaner console
suppressDevelopmentWarnings();
suppressViolationWarnings();

// Component to add "Show in Canvas" button to thread messages with components
interface ShowInCanvasButtonProps {
  messageId: string;
  component: React.ReactNode;
}

function ShowInCanvasButton({ messageId, component }: ShowInCanvasButtonProps) {
  const handleShowInCanvas = () => {
    window.dispatchEvent(
      new CustomEvent("tambo:showComponent", {
        detail: { messageId, component },
      })
    );
  };

  return (
    <button
      onClick={handleShowInCanvas}
      className="text-xs text-blue-600 hover:text-blue-800 mt-1"
    >
      Show in Canvas
    </button>
  );
}

// Extended thread content that filters to only show assistant messages
function ExtendedThreadContent() {
  const { thread } = useTamboThread();

  return (
    <ThreadContent>
      <div className="space-y-4">
        {thread?.messages
          ?.filter((message) => message.role === "assistant")
          .map((message, index) => (
            <div
              key={message.id || `assistant-${index}`}
              className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ease-out"
            >
              <Message
                role="assistant"
                message={message}
                className="flex justify-start"
              >
                <div className="flex flex-col">
                  <MessageContent className="text-primary font-sans" />

                  {message.renderedComponent && (
                    <div className="flex justify-end mt-1">
                      <ShowInCanvasButton
                        messageId={message.id || `msg-${index}`}
                        component={message.renderedComponent}
                      />
                    </div>
                  )}
                </div>
              </Message>
            </div>
          ))}
      </div>
    </ThreadContent>
  );
}

export default function Voice() {
  // Load MCP server configurations
  const mcpServers = loadMcpServers();
  const contextKey = "tambo-voice-chat";

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-hidden">
        {/* MCP Config Button */}
        <McpConfigButton />

        {/* MCP Status Indicator */}
        <div className="absolute top-16 right-4 z-10">
          <McpStatusIndicator showDetails={false} />
        </div>

        {/* Main content section */}
        <div className="w-full h-full relative">
          <div className="p-6 max-w-full mx-auto">
            <h1 className="text-3xl font-bold mb-6">Voice Assistant Demo</h1>
          </div>

          {/* Tambo Chat Component */}
          <TamboProvider
            apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
            components={components}
          >
            <EnhancedMcpProvider mcpServers={mcpServers}>
              {/* Split view layout with canvas on left and thread on right */}
              <div className="flex h-[calc(100vh-200px)]">
                {/* Canvas Space on the left */}
                <CanvasSpace className="w-1/2 border-r" />

                {/* Thread Container with Scrollable Content on the right */}
                <div className="w-1/2 flex flex-col">
                  <ThreadContainer className="flex-1 h-full">
                    <ScrollableMessageContainer className="p-4 pt-12 flex-1 h-full">
                      <ExtendedThreadContent />
                    </ScrollableMessageContainer>
                  </ThreadContainer>

                  {/* LiveKit fixed at the bottom */}
                  <LiveKitProvider>
                    <RpcHandler contextKey={contextKey} />
                    <div className="sticky bottom-0 z-10 bg-background">
                      <LiveKitUI />
                    </div>
                  </LiveKitProvider>
                </div>
              </div>
              
              {/* LivekitParticipantSpawner moved inside TamboProvider context */}
              <LiveKitProvider>
                <LivekitParticipantSpawner />
              </LiveKitProvider>
            </EnhancedMcpProvider>
          </TamboProvider>
        </div>
      </div>
    </div>
  );
}
