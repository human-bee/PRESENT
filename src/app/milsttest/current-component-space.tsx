"use client";

import { getSafeContent } from "@/lib/thread-hooks";
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

  const messageContent = getSafeContent(latestComponentMessage.content);
  const messageTime = latestComponentMessage.createdAt
    ? new Date(latestComponentMessage.createdAt).toLocaleTimeString()
    : "Unknown time";

  return (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      <div className="border-b pb-2">
        <h3 className="text-lg font-medium">Latest Component</h3>
        <p className="text-sm text-muted-foreground">
          From message: {latestComponentMessage.id || "Unknown"}
        </p>
        <p className="text-xs text-muted-foreground">Created: {messageTime}</p>
      </div>

      {/* Show the message content that led to this component */}
      {messageContent && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Message Content:</h4>
          <div className="text-sm p-3 bg-muted rounded-md">
            {typeof messageContent === "string"
              ? messageContent
              : "Component content"}
          </div>
        </div>
      )}

      {/* Show the rendered component */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Rendered Component:</h4>
        <div className="border rounded-lg p-4 bg-background min-h-[200px]">
          {latestComponentMessage.renderedComponent}
        </div>
      </div>
    </div>
  );
}
