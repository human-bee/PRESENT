"use client";
import { useTambo } from "@tambo-ai/react";
import React from "react";

export function CurrentComponentSpace() {
  const { thread } = useTambo();

  // Find the latest message with a rendered component by walking backwards from the end
  const latestComponentMessage = React.useMemo(() => {
    if (!thread?.messages?.length) return null;

    // Walk backwards through messages to find the latest one with a renderedComponent
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const message = thread.messages[i];
      if (message.renderedComponent) {
        return message;
      }
    }

    return null;
  }, [thread?.messages]);

  if (!latestComponentMessage) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <div className="text-lg font-medium mb-2">No Component Rendered</div>
        <div className="text-sm">
          Start a conversation with Tambo to see rendered components here.
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-4 h-full max-h-full">
      <div className="space-y-2">
        <div className="min-h-[200px]">
          {latestComponentMessage.renderedComponent}
        </div>
      </div>
    </div>
  );
}
